// src/lib/source/fetch-url.ts
// IMPURE edge: server-side fetch of a source URL → readable text via htmlToText.
import { htmlToText } from '@/lib/source/html-to-text';

export async function fetchUrlText(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'llm-tutor/1.0' } });
  } catch (err) {
    throw new Error(`Could not fetch URL: ${String(err)}`);
  }
  if (!res.ok) throw new Error(`URL fetch failed: ${res.status} ${res.statusText}`);
  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text();
  if (ct.includes('text/html') || /<html|<body|<p[ >]/i.test(body)) return htmlToText(body);
  // Plain text / markdown / json source: pass through.
  return body.trim();
}
