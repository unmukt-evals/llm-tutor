import matter from 'gray-matter';
import type { Diagram, Drill, Module, StressTest, TrackId } from '@/lib/types';

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

/**
 * Parse "### Drill N" sections from the sections map.
 * Each drill block contains "Scenario:", optional "DC1:", optional "DC2:" lines.
 */
function parseDrills(sections: Map<string, string>): Drill[] {
  const drills: Drill[] = [];
  for (const [heading, text] of sections) {
    if (!/^Drill\b/i.test(heading)) continue;
    const grab = (label: string): string | undefined => {
      const re = new RegExp(`^${label}:\\s*(.*)$`, 'im');
      const match = re.exec(text);
      return match ? match[1].trim() : undefined;
    };
    const scenario = grab('Scenario') ?? '';
    const drill: Drill = { scenario };
    const dc1 = grab('DC1');
    const dc2 = grab('DC2');
    if (dc1 !== undefined) drill.dc1 = dc1;
    if (dc2 !== undefined) drill.dc2 = dc2;
    drills.push(drill);
  }
  return drills;
}

/**
 * Parse "## Stress-test pool" section lines into StressTest objects.
 * Each line is: `- board: <question>` (lens ∈ board|researcher|analyst).
 */
function parseStressTests(section: string | undefined): StressTest[] {
  if (!section) return [];
  const out: StressTest[] = [];
  for (const raw of section.split('\n')) {
    const line = raw.replace(/^\s*[-*]\s*/, '').trim();
    const match = /^(board|researcher|analyst):\s*(.*)$/i.exec(line);
    if (match) {
      out.push({ lens: match[1].toLowerCase() as StressTest['lens'], question: match[2].trim() });
    }
  }
  return out;
}

/**
 * Parse a bullet-list section (e.g. "## Flashcard seeds", "## Sources") into
 * a plain string array with leading list markers stripped.
 */
function parseBulletLines(section: string | undefined): string[] {
  if (!section) return [];
  return section
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
    .filter((l) => l.length > 0);
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
    drills: parseDrills(sections),
    stressTests: parseStressTests(sections.get('Stress-test pool')),
    flashcardSeeds: parseBulletLines(sections.get('Flashcard seeds')),
    sources: parseBulletLines(sections.get('Sources')),
  };
}
