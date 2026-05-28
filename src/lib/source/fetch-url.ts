// src/lib/source/fetch-url.ts
// IMPURE edge: server-side fetch of a source URL → readable text via htmlToText.
// Includes an SSRF guard with DNS-rebinding hardening (resolve-and-recheck).
import dns from 'node:dns';
import net from 'node:net';
import { htmlToText } from '@/lib/source/html-to-text';

// ---------- Pure helpers ----------

// IP-range rules (single source of truth):
//   IPv4:
//     - 127.0.0.0/8         loopback
//     - 10.0.0.0/8          private
//     - 172.16.0.0/12       private  (172.16.0.0 – 172.31.255.255)
//     - 192.168.0.0/16      private
//     - 169.254.0.0/16      link-local (incl. cloud metadata 169.254.169.254)
//     - 0.0.0.0             unspecified / wildcard
//   IPv6:
//     - ::1                 loopback
//     - ::                  unspecified
//     - fc00::/7            unique local (fc.. / fd..)
//     - fe80::/10           link-local
//     - ::ffff:a.b.c.d      IPv4-mapped — re-checked as IPv4
export function isUnsafeIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isUnsafeIpv4(ip);
  if (family === 6) return isUnsafeIpv6(ip);
  return false; // not an IP literal — caller's responsibility
}

function isUnsafeIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Shouldn't happen given net.isIP(ip) === 4, but be defensive.
    return false;
  }
  const [a, b] = parts;
  if (a === 0 && b === 0 && parts[2] === 0 && parts[3] === 0) return true; // 0.0.0.0
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  return false;
}

function isUnsafeIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true; // unspecified

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — defer to IPv4 logic.
  const v4MappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) return isUnsafeIpv4(v4MappedMatch[1]);

  // fc00::/7 — unique local (first byte 0xfc or 0xfd).
  // fe80::/10 — link-local (fe80..febf prefix).
  const firstHextet = lower.split(':')[0];
  if (/^fc[0-9a-f]{0,2}$/.test(firstHextet) || /^fd[0-9a-f]{0,2}$/.test(firstHextet)) return true;
  if (/^fe[89ab][0-9a-f]?$/.test(firstHextet)) return true;

  return false;
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::', '[::]']);

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

  const rawHost = parsed.hostname.toLowerCase();
  // Node's WHATWG URL keeps the brackets on IPv6 literals (e.g. "[::1]").
  // Strip them so net.isIP / isUnsafeIp see the bare address.
  const host =
    rawHost.startsWith('[') && rawHost.endsWith(']')
      ? rawHost.slice(1, -1)
      : rawHost;

  if (LOOPBACK_HOSTNAMES.has(host)) {
    throw new Error(`Unsafe URL: "${host}" is a loopback/wildcard address.`);
  }

  const ipFamily = net.isIP(host);
  if (ipFamily !== 0) {
    if (isUnsafeIp(host)) {
      throw new Error(`Unsafe URL: "${host}" is a private/link-local/loopback address.`);
    }
    return parsed;
  }

  return parsed;
}

/**
 * DNS-rebinding hardening: resolve the hostname and reject if ANY answer is a
 * private/loopback/link-local IP.
 *
 * NOTE: this narrows the rebinding window but does NOT fully close it. A truly
 * complete fix requires resolving once, pinning the resolved IP, and binding
 * `fetch` to that IP (Node's `undici` does not currently expose a portable hook
 * for this). Treat this guard as defence-in-depth, not as a replacement for
 * network-layer isolation (egress firewall, dedicated subnet, etc.).
 */
export async function assertResolvedIpSafe(
  hostname: string,
  lookup: typeof dns.promises.lookup = dns.promises.lookup,
): Promise<void> {
  // Normalise bracketed IPv6 literals (e.g. "[::1]") that come straight from URL.hostname.
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  // Skip resolution for IP literals — assertSafeFetchUrl already validated those.
  if (net.isIP(bare) !== 0) return;

  let addrs: dns.LookupAddress[];
  try {
    addrs = await lookup(bare, { all: true });
  } catch (err) {
    throw new Error(`Could not resolve hostname "${bare}": ${String(err)}`);
  }

  for (const a of addrs) {
    if (isUnsafeIp(a.address)) {
      throw new Error(
        `unsafe URL (resolved IP is private/loopback/link-local): ${hostname} → ${a.address}`,
      );
    }
  }
}

export async function fetchUrlText(url: string): Promise<string> {
  // Guard against SSRF: rejects loopback, private, link-local IPs and non-http(s) schemes.
  const parsed = assertSafeFetchUrl(url);
  // DNS-rebinding hardening for hostname URLs. IP literals are already blocked above.
  await assertResolvedIpSafe(parsed.hostname);

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
