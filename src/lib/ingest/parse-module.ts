import matter from 'gray-matter';
import type { Diagram, Module, TrackId } from '@/lib/types';

/**
 * Split markdown body into a map keyed by exact heading text (without the `#`s).
 * Returns the raw text under each heading (trimmed), for both ## and ### levels.
 * The preamble before any heading (key '') is ignored.
 */
function sectionsByHeading(body: string): Map<string, string> {
  const lines = body.split('\n');
  const sections = new Map<string, string>();
  let currentHeading = '';
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (currentHeading) sections.set(currentHeading, buffer.join('\n').trim());
    buffer = [];
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    const headingMatch = !inFence ? /^(#{2,3})\s+(.*)$/.exec(line) : null;
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[2].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Extract fenced code blocks from a pass body and return them as Diagram objects.
 * - Opening fence language tag determines `kind`:
 *   - `mermaid` → 'mermaid'
 *   - `text` | `ascii` | (empty) → 'ascii'
 *   - any other language (e.g. `python`, `ts`) → 'code'
 * - `body` = inner text only (fences + language tag stripped, trimmed).
 */
function extractDiagrams(passText: string | undefined): Diagram[] {
  if (!passText) return [];
  const out: Diagram[] = [];
  const lines = passText.split('\n');
  let inFence = false;
  let currentKind: Diagram['kind'] = 'ascii';
  let buffer: string[] = [];

  for (const line of lines) {
    const fence = /^```(\w*)\s*$/.exec(line.trimStart());
    if (fence) {
      if (!inFence) {
        const lang = fence[1].toLowerCase();
        if (lang === 'mermaid') {
          currentKind = 'mermaid';
        } else if (lang === '' || lang === 'text' || lang === 'ascii') {
          currentKind = 'ascii';
        } else {
          currentKind = 'code';
        }
        inFence = true;
        buffer = [];
      } else {
        out.push({ kind: currentKind, body: buffer.join('\n').trim() });
        inFence = false;
      }
      continue;
    }
    if (inFence) buffer.push(line);
  }
  return out;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v === undefined || v === null) return [];
  return [String(v)];
}

export function parseModule(raw: string): Module {
  const { data, content } = matter(raw);
  const sections = sectionsByHeading(content);

  const id = String(data.module_id ?? '');
  const track = String(data.track ?? 'A') as TrackId;
  const name = String(data.name ?? '');

  const passes: Module['passes'] = {};
  const tenYearOld = sections.get('10-year-old pass');
  const engineer = sections.get('Engineer pass');
  const operator = sections.get('Operator pass');
  if (tenYearOld !== undefined) passes.tenYearOld = tenYearOld;
  if (engineer !== undefined) passes.engineer = engineer;
  if (operator !== undefined) passes.operator = operator;

  const anchorsText = sections.get('Anchor scenarios');
  let anchors: string[];
  if (!anchorsText) {
    anchors = [];
  } else {
    const listMarker = /^\s*(?:\d+\.|[-*])\s+/;
    const listItems = anchorsText
      .split('\n')
      .filter((line) => listMarker.test(line))
      .map((line) => line.replace(listMarker, '').trim());
    anchors = listItems.length > 0 ? listItems : [anchorsText.trim()];
  }

  return {
    id,
    track,
    name,
    prerequisites: asStringArray(data.prerequisites),
    primarySources: asStringArray(data.primary_sources),
    whyThisMatters: sections.get('Why this matters') ?? '',
    anchors,
    passes,
    diagrams: extractDiagrams(passes.engineer),
    labSpec: sections.get('Lab spec'),
    drills: [],
    stressTests: [],
    flashcardSeeds: [],
    sources: [],
  };
}
