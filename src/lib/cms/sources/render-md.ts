/**
 * render-md.ts — Pure, deterministic renderer: SourcesDoc → _sources.md string.
 *
 * Public API:
 *   renderSourcesMd(doc: SourcesDoc, opts?: { now?: Date }): string
 *
 * Guarantees:
 *   - Same input + same opts.now → byte-identical output (idempotent).
 *   - No side effects: no fs I/O, no Date.now(), no Math.random().
 *   - LF (\n) line endings throughout.
 *   - Output ends with exactly one trailing \n.
 *
 * The format mirrors the hand-authored `_sources.md` file:
 *   - YAML frontmatter (type + verified)
 *   - Top heading
 *   - Standing intro (hard-coded verbatim from the live file)
 *   - Horizontal rule
 *   - Per-cluster sections, in first-encounter order from doc.sources[]
 *   - Horizontal rule between clusters
 *   - Per-source blocks (### heading + bullet list)
 */

import type { Source } from '@/lib/types';
import type { SourcesDoc } from '@/lib/cms/types';

// ── Standing intro text (copied verbatim from the live _sources.md) ──────────
//
// These two paragraphs appear after the top heading and before the first cluster.
// They are hard-coded here so the renderer is self-contained and the output
// matches the existing file structure exactly.

const STANDING_INTRO =
  'These nine sources were recommended to Unmukt by colleagues and are the spine of Track B. The rule (see SKILL.md): **teach from the source, quote the source, link the source.** When a module\'s engineer-pass makes a claim, it should trace to a line below.';

const JS_GATED_HINT =
  'Two of the nine (RL-environments guide, Collinear post) are JS-gated and were recovered via browser render on 2026-05-26 — content is captured here so a session never has to re-fetch.';

// ── renderSourcesMd ────────────────────────────────────────────────────────────

export interface RenderOpts {
  /** Override the current date used for the `verified:` frontmatter field.
   *  Defaults to `new Date()` at call time. Pass a fixed Date in tests. */
  now?: Date;
}

/**
 * Render a `SourcesDoc` to the full `_sources.md` string.
 *
 * @param doc   The in-memory source-library document.
 * @param opts  Optional overrides (only `now` is consumed).
 * @returns     The full markdown string, ending with `\n`.
 */
export function renderSourcesMd(doc: SourcesDoc, opts?: RenderOpts): string {
  const now = opts?.now ?? new Date();
  const verified = now.toISOString().slice(0, 10);

  const parts: string[] = [];

  // ── Frontmatter ────────────────────────────────────────────────────────────
  parts.push('---');
  parts.push('type: source-library');
  parts.push(`verified: ${verified}`);
  parts.push('---');
  parts.push('');

  // ── Top heading ────────────────────────────────────────────────────────────
  parts.push('# Track B — Primary Source Library');
  parts.push('');

  // ── Standing intro ─────────────────────────────────────────────────────────
  parts.push(STANDING_INTRO);
  parts.push('');
  parts.push(JS_GATED_HINT);
  parts.push('');

  // ── Horizontal rule before clusters ──────────────────────────────────────
  parts.push('---');

  // ── Group sources by cluster (first-encounter order) ─────────────────────
  //
  // We walk doc.sources[] once, collecting cluster names in order of first
  // encounter, and bucketing sources into per-cluster arrays.

  const clusterOrder: string[] = []; // first-encounter order
  const clusterMap = new Map<string, Source[]>(); // cluster name → sources

  for (const source of doc.sources) {
    const clusterName = source.cluster ?? '__unfiled__';
    if (!clusterMap.has(clusterName)) {
      clusterOrder.push(clusterName);
      clusterMap.set(clusterName, []);
    }
    clusterMap.get(clusterName)!.push(source);
  }

  // Move '__unfiled__' to the end if present
  const unfiledIdx = clusterOrder.indexOf('__unfiled__');
  if (unfiledIdx !== -1) {
    clusterOrder.splice(unfiledIdx, 1);
    clusterOrder.push('__unfiled__');
  }

  // ── Render each cluster ────────────────────────────────────────────────────
  for (let ci = 0; ci < clusterOrder.length; ci++) {
    const clusterName = clusterOrder[ci];
    const displayName = clusterName === '__unfiled__' ? 'Unfiled' : clusterName;
    const sources = clusterMap.get(clusterName)!;

    parts.push('');
    parts.push(`## ${displayName}`);

    for (const source of sources) {
      parts.push('');
      parts.push(`### ${source.id} · ${source.title}`);
      parts.push('');

      // Render bullet lines in fixed order; omit missing/empty fields entirely
      const bullets: string[] = [];

      if (source.url) {
        bullets.push(`- **URL:** ${source.url}`);
      }
      if (source.summary) {
        bullets.push(`- **What:** ${source.summary}`);
      }
      if (source.thesis) {
        bullets.push(`- **Thesis:** ${source.thesis}`);
      }
      if (source.mechanism) {
        bullets.push(`- **Mechanism that matters:** ${source.mechanism}`);
      }
      if (source.quotes && source.quotes.length > 0) {
        for (const quote of source.quotes) {
          bullets.push(`- **Quote:** ${quote}`);
        }
      }
      if (source.grounds && source.grounds.length > 0) {
        bullets.push(`- **Grounds:** ${source.grounds.join(', ')}`);
      }

      parts.push(...bullets);
      parts.push('');
    }

    // Horizontal rule between clusters (but NOT after the last one)
    if (ci < clusterOrder.length - 1) {
      parts.push('---');
    }
  }

  // ── Final assembly ─────────────────────────────────────────────────────────
  //
  // Join all parts with \n. When cluster sections are present, the trailing ''
  // entry after the last source block means join() ends with \n naturally.
  // When there are no clusters (empty doc), the last entry is '---' and we
  // must append the final \n explicitly.

  const raw = parts.join('\n');
  return raw.endsWith('\n') ? raw : raw + '\n';
}
