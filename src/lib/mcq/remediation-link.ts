// Pure helper: build the reader deep-link href for a question's remediation
// moduleRef. The anchor is the EXACT heading text; we slugify it with the same
// github-slugger that `rehype-slug` uses in the reader, so the link lands on the
// matching heading id. No DOM — node-testable.
import GithubSlugger from 'github-slugger';
import type { ModuleRef } from '@/lib/types';

export function moduleRefHref(moduleId: string, ref: ModuleRef): string {
  const base = `/module/${encodeURIComponent(moduleId)}?pass=${ref.pass}`;
  if (!ref.anchor) return base;
  // Fresh slugger per call: a single anchor maps to the heading's base slug.
  const slug = new GithubSlugger().slug(ref.anchor);
  return slug ? `${base}#${slug}` : base;
}
