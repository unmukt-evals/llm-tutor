/**
 * migrate-from-md.ts — One-time heuristic parser: _sources.md → SourcesDoc.
 *
 * Public API:
 *   parseSourcesMd(raw: string, opts?: { now?: number }): SourcesDoc
 *
 * The parser walks the markdown line-by-line, keeping a simple state machine:
 *   - Frontmatter + standing intro (before first ## Cluster) → ignored.
 *   - "## Cluster …" → updates current cluster.
 *   - "### <id> · <title>" → flushes previous source (if any), starts new one.
 *   - "- **Label:** value" bullets → populates matching Source field.
 *   - Continuation lines (non-blank, not a heading or new bullet) → appended to
 *     the current bullet value with a single space separator.
 *
 * Liberalism rules:
 *   - Middle dot (·, U+00B7) or em-dash or plain hyphen may separate id from
 *     title; the parser tries · first, then ` - ` (space-hyphen-space), then
 *     uses the whole heading minus the id token.
 *   - Multi-line bullet values are reconstructed by concatenating continuation
 *     lines.
 *   - Empty/whitespace-only entries in quotes[] and grounds[] are filtered out
 *     (matches the renderer's behavior so round-trip stays clean).
 *
 * content_hash: computed via computeContentHash over the same canonical
 * serialization that json-store uses (HASH_KEY_ORDER subset).
 *
 * updated_at: opts.now ?? Date.now().
 *
 * IDs are preserved verbatim from the headings — never re-minted.
 */

import type { Source, SourceKind } from '@/lib/types';
import type { SourcesDoc } from '@/lib/cms/types';
import { computeContentHash } from '@/lib/cms/hash';

// ── Canonical hash input (mirrors json-store.ts HASH_KEY_ORDER) ──────────────

const HASH_KEY_ORDER: ReadonlyArray<keyof Source> = [
  'kind',
  'title',
  'url',
  'author',
  'cluster',
  'summary',
  'thesis',
  'mechanism',
  'quotes',
  'grounds',
  'raw_text',
  'fetched_at',
];

function canonicalHashInput(s: Partial<Source>): string {
  const obj: Record<string, unknown> = {};
  for (const key of HASH_KEY_ORDER) {
    const val = (s as Record<string, unknown>)[key];
    if (val !== undefined) {
      obj[key] = val;
    }
  }
  return JSON.stringify(obj);
}

// ── Bullet label → Source field mapping ──────────────────────────────────────

type BulletKind = 'url' | 'what' | 'thesis' | 'mechanism' | 'quote' | 'grounds';

/** Regex that matches a bullet line and captures the label and value.
 *  Group 1 = label text (e.g. "URL", "What", "Mechanism that matters").
 *  Group 2 = value text (everything after ": ", may be empty). */
const BULLET_RE = /^- \*\*(URL|What|Thesis|Mechanism that matters|Quote[^*]*|Grounds):\*\*\s*(.*)/;

function labelToBulletKind(label: string): BulletKind | null {
  const l = label.trim();
  if (l === 'URL') return 'url';
  if (l === 'What') return 'what';
  if (l === 'Thesis' || l.startsWith('Thesis')) return 'thesis';
  if (l === 'Mechanism that matters') return 'mechanism';
  if (l.startsWith('Quote')) return 'quote';
  if (l === 'Grounds') return 'grounds';
  return null;
}

// ── Source heading parser ─────────────────────────────────────────────────────

/** Parse a `### …` heading line.
 *
 * Returns `{ id, title }` when the line looks like a source heading
 * (`### <token> <separator> <rest>`), or `null` otherwise.
 *
 * Separator priority: U+00B7 middle dot (·), then " - " (space-hyphen-space).
 * If neither is found, the whole text after the first whitespace-delimited
 * token is used as the title.
 */
function parseSourceHeading(line: string): { id: string; title: string } | null {
  // Must start with "### "
  if (!line.startsWith('### ')) return null;

  const body = line.slice(4).trim(); // text after "### "
  if (!body) return null;

  // First whitespace-delimited token = id
  const spaceIdx = body.search(/\s/);
  if (spaceIdx === -1) {
    // Only one token — whole body is id, title is empty string
    return { id: body, title: '' };
  }

  const id = body.slice(0, spaceIdx).trim();
  const rest = body.slice(spaceIdx).trim();

  // Try middle dot (U+00B7) first
  const dotIdx = rest.indexOf('·');
  if (dotIdx !== -1) {
    const title = rest.slice(dotIdx + 1).trim();
    return { id, title };
  }

  // Try " - " (space-hyphen-space)
  const dashIdx = rest.indexOf(' - ');
  if (dashIdx !== -1) {
    const title = rest.slice(dashIdx + 3).trim();
    return { id, title };
  }

  // Fall back: rest is the title
  return { id, title: rest };
}

// ── Cluster heading parser ─────────────────────────────────────────────────────

/** Returns the cluster name from a `## …` line, or null if not a cluster heading. */
function parseClusterHeading(line: string): string | null {
  if (!line.startsWith('## ')) return null;
  const name = line.slice(3).trim();
  // Ignore the "Source → module map" section and anything that isn't a cluster
  if (!name) return null;
  return name;
}

// ── In-progress source accumulator ───────────────────────────────────────────

interface PartialSource {
  id: string;
  title: string;
  cluster?: string;
  url?: string;
  summary?: string;
  thesis?: string;
  mechanism?: string;
  quotes: string[];
  grounds: string[];
  // Mutable cursor for multi-line continuation
  _currentBulletKind: BulletKind | null;
}

function makePartial(id: string, title: string, cluster?: string): PartialSource {
  return {
    id,
    title,
    cluster,
    quotes: [],
    grounds: [],
    _currentBulletKind: null,
  };
}

/** Append a continuation string to the current bullet in progress. */
function appendContinuation(partial: PartialSource, continuation: string): void {
  if (!partial._currentBulletKind) return;

  switch (partial._currentBulletKind) {
    case 'url':
      partial.url = (partial.url ?? '') + ' ' + continuation;
      break;
    case 'what':
      partial.summary = (partial.summary ?? '') + ' ' + continuation;
      break;
    case 'thesis':
      partial.thesis = (partial.thesis ?? '') + ' ' + continuation;
      break;
    case 'mechanism':
      partial.mechanism = (partial.mechanism ?? '') + ' ' + continuation;
      break;
    case 'quote': {
      const last = partial.quotes.length - 1;
      if (last >= 0) {
        partial.quotes[last] = partial.quotes[last] + ' ' + continuation;
      }
      break;
    }
    case 'grounds': {
      const last = partial.grounds.length - 1;
      if (last >= 0) {
        partial.grounds[last] = partial.grounds[last] + ' ' + continuation;
      }
      break;
    }
  }
}

/** Process a bullet line and update partial. */
function applyBullet(partial: PartialSource, label: string, value: string): void {
  const kind = labelToBulletKind(label);
  if (!kind) {
    partial._currentBulletKind = null;
    return;
  }
  partial._currentBulletKind = kind;

  switch (kind) {
    case 'url':
      partial.url = value;
      break;
    case 'what':
      partial.summary = value;
      break;
    case 'thesis':
      partial.thesis = value;
      break;
    case 'mechanism':
      partial.mechanism = value;
      break;
    case 'quote':
      // Empty Quote: bullet → skip (filtered later, but don't push empty here)
      if (value.trim() !== '') partial.quotes.push(value);
      else partial.quotes.push(''); // pushed for now, filtered during flush
      break;
    case 'grounds':
      // Grounds is split on commas at flush time; for now store the raw value.
      // We store it as a single "raw" entry that we'll re-split at flush.
      // Simplest approach: store raw in a temporary accumulator.
      // We repurpose the grounds array to hold raw comma-joined text temporarily
      // — a fresh partial always starts with grounds = [].
      partial.grounds.push(value);
      break;
  }
}

// ── Flush: convert PartialSource → Source ────────────────────────────────────

function flushSource(partial: PartialSource, updatedAt: number): Source {
  // Normalize url: take the first whitespace-delimited token (handles
  // "https://... *(JS-gated; recovered 2026-05-26)*" annotations)
  let url: string | undefined = partial.url?.trim();
  if (url) {
    // Take first token (before any whitespace), removing trailing punctuation
    // that's not part of a URL (e.g. a trailing space before a parenthetical).
    const firstToken = url.split(/\s/)[0];
    url = firstToken || undefined;
  }

  // Filter empty/whitespace-only quotes
  const quotes = partial.quotes.filter((q) => q.trim() !== '');

  // Parse grounds: each entry in partial.grounds is a raw comma-joined string
  // (may be spread across continuation lines). Join them, then split on comma.
  // Strip trailing periods — the live hand-authored file ends every Grounds:
  // bullet with a sentence-terminating period (e.g. "B2 (primary), B3.") but
  // the period is never part of a module ID. Stripping it keeps round-trips
  // clean (renderer emits no trailing period).
  const rawGrounds = partial.grounds.join(' ');
  const grounds = rawGrounds
    .split(',')
    .map((g) => g.trim().replace(/\.$/, ''))
    .filter((g) => g !== '');

  const kind: SourceKind = url ? 'url' : 'doc';

  // Build the source object for hashing (exclude id, content_hash, updated_at)
  const forHash: Partial<Source> = {
    kind,
    title: partial.title,
    ...(url !== undefined && { url }),
    ...(partial.cluster !== undefined && { cluster: partial.cluster }),
    ...(partial.summary !== undefined && { summary: partial.summary }),
    ...(partial.thesis !== undefined && { thesis: partial.thesis }),
    ...(partial.mechanism !== undefined && { mechanism: partial.mechanism }),
    ...(quotes.length > 0 && { quotes }),
    ...(grounds.length > 0 && { grounds }),
  };

  const content_hash = computeContentHash(canonicalHashInput(forHash));

  const source: Source = {
    id: partial.id,
    kind,
    title: partial.title,
    content_hash,
    updated_at: updatedAt,
  };

  if (url !== undefined) source.url = url;
  if (partial.cluster !== undefined) source.cluster = partial.cluster;
  if (partial.summary !== undefined) source.summary = partial.summary;
  if (partial.thesis !== undefined) source.thesis = partial.thesis;
  if (partial.mechanism !== undefined) source.mechanism = partial.mechanism;
  if (quotes.length > 0) source.quotes = quotes;
  if (grounds.length > 0) source.grounds = grounds;

  return source;
}

// ── parseSourcesMd ────────────────────────────────────────────────────────────

export interface ParseOpts {
  /** Override Date.now() for deterministic tests. */
  now?: number;
}

/**
 * Parse a hand-authored `_sources.md` file and return a `SourcesDoc`.
 *
 * Only the structural content from the first `## Cluster …` heading onward is
 * parsed. Frontmatter and the standing intro text are silently dropped.
 *
 * IDs are preserved verbatim from the `### <id> · <title>` headings.
 */
export function parseSourcesMd(raw: string, opts?: ParseOpts): SourcesDoc {
  const updatedAt = opts?.now ?? Date.now();
  const lines = raw.split('\n');

  const sources: Source[] = [];
  let inContent = false; // true once we've seen the first ## Cluster heading
  let currentCluster: string | undefined = undefined;
  let current: PartialSource | null = null;

  for (const rawLine of lines) {
    const line = rawLine; // keep indentation for continuation detection

    // ── Detect first cluster heading (start of structural content) ──────────
    if (!inContent) {
      const cluster = parseClusterHeading(line.trim());
      if (cluster !== null) {
        inContent = true;
        currentCluster = cluster;
      }
      continue;
    }

    // ── From here, we're in structural content ───────────────────────────────

    const trimmed = line.trim();

    // Cluster heading
    if (trimmed.startsWith('## ')) {
      const cluster = parseClusterHeading(trimmed);
      if (cluster !== null) {
        currentCluster = cluster;
        if (current) current._currentBulletKind = null;
      }
      continue;
    }

    // Source heading (### …)
    if (trimmed.startsWith('### ')) {
      // Flush previous source
      if (current) {
        sources.push(flushSource(current, updatedAt));
      }
      const parsed = parseSourceHeading(trimmed);
      if (parsed) {
        current = makePartial(parsed.id, parsed.title, currentCluster);
      } else {
        current = null;
      }
      continue;
    }

    // No current source in progress → skip
    if (!current) continue;

    // Bullet line
    const bulletMatch = trimmed.match(BULLET_RE);
    if (bulletMatch) {
      const label = bulletMatch[1];
      const value = bulletMatch[2] ?? '';
      applyBullet(current, label, value);
      continue;
    }

    // Horizontal rule or empty line → reset continuation cursor
    if (trimmed === '---' || trimmed === '') {
      current._currentBulletKind = null;
      continue;
    }

    // Continuation line: non-blank, not a heading, not a bullet, not a rule.
    // The raw line starts with whitespace (indented) OR the current bullet
    // is a multi-line block (e.g. Mechanism that matters has bullet sub-items).
    // We concatenate it into the current bullet.
    if (current._currentBulletKind !== null && trimmed !== '') {
      // Sub-bullets (lines starting with "  -") under mechanism/thesis are
      // part of the value — include them as continuation text.
      appendContinuation(current, trimmed);
    }
  }

  // Flush last source
  if (current) {
    sources.push(flushSource(current, updatedAt));
  }

  return { version: 1, sources };
}
