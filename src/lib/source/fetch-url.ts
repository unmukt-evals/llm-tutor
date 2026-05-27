// src/lib/source/fetch-url.ts
// IMPURE edge: server-side fetch of a source URL → readable text via htmlToText.
import { htmlToText } from '@/lib/source/html-to-text';

// Private IP ranges to block (SSRF guard).
// Covers loopback, private, link-local (incl. cloud metadata 169.254.169.254), and wildcard.
// Residual limitation: DNS-rebinding attacks are out of scope — we only check the literal
// IP/hostname supplied; a hostname that resolves to a private IP at fetch time is not blocked here.

const PRIVATE_IPV4_RE =
  /^(127\.|10\.|169\.254\.|0\.0\.0\.0$|(?:172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.))/;

const LOOPBACK_HOSTNAMES = new Set(['localhost', '0.0.0.0', '[::]', '::1']);

export function assertSafeFetchUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsafe URL scheme "${parsed.protocol}" — only http/https are allowed.`);
  }

  const host = parsed.hostname.toLowerCase();

  if (LOOPBACK_HOSTNAMES.has(host)) {
    throw new Error(`Unsafe URL: "${host}" is a loopback/wildcard address.`);
  }

  if (PRIVATE_IPV4_RE.test(host)) {
    throw new Error(`Unsafe URL: "${host}" is a private/link-local/loopback address.`);
  }

  return parsed;
}

export async function fetchUrlText(url: string): Promise<string> {
  // Guard against SSRF: rejects loopback, private, link-local IPs and non-http(s) schemes.
  assertSafeFetchUrl(url);

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
