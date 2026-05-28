// src/lib/source/html-to-text.ts
// PURE, dependency-free HTML → readable text. Good enough for feeding a source
// page into the LLM: drops script/style, converts block boundaries to newlines,
// strips remaining tags, decodes common entities, collapses whitespace.

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function htmlToText(html: string): string {
  if (!html) return '';
  let s = html;
  // Drop script/style blocks (content included).
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  // Block-level close/break tags → newline boundaries.
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  // Decode common entities.
  s = s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, (m) => ENTITIES[m] ?? m);
  // Collapse runs of spaces/tabs, trim each line, drop blank lines, trim ends.
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return s.trim();
}
