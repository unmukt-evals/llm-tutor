import matter from 'gray-matter';
import type { Module, TrackId } from '@/lib/types';

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
  const anchors = anchorsText ? [anchorsText] : [];

  return {
    id,
    track,
    name,
    prerequisites: asStringArray(data.prerequisites),
    primarySources: asStringArray(data.primary_sources),
    whyThisMatters: sections.get('Why this matters') ?? '',
    anchors,
    passes,
    diagrams: [],
    labSpec: sections.get('Lab spec'),
    drills: [],
    stressTests: [],
    flashcardSeeds: [],
    sources: [],
  };
}
