// src/lib/source/__tests__/fetch-url.test.ts
// Pure unit tests for assertSafeFetchUrl, isUnsafeIp, and assertResolvedIpSafe —
// no network required (DNS lookup is injected as a stub).
import { describe, it, expect } from 'vitest';
import type { LookupAddress } from 'node:dns';
import {
  assertSafeFetchUrl,
  isUnsafeIp,
  assertResolvedIpSafe,
} from '@/lib/source/fetch-url';

describe('assertSafeFetchUrl', () => {
  // --- Allowed ---
  it('allows https://example.com/', () => {
    expect(() => assertSafeFetchUrl('https://example.com/')).not.toThrow();
  });

  it('allows http://example.com', () => {
    expect(() => assertSafeFetchUrl('http://example.com')).not.toThrow();
  });

  // --- Scheme rejections ---
  it('rejects file:// scheme', () => {
    expect(() => assertSafeFetchUrl('file:///etc/passwd'))
      .toThrow(/Unsafe URL scheme/);
  });

  it('rejects ftp:// scheme', () => {
    expect(() => assertSafeFetchUrl('ftp://example.com/file'))
      .toThrow(/Unsafe URL scheme/);
  });

  it('rejects data: scheme', () => {
    expect(() => assertSafeFetchUrl('data:text/plain,hello'))
      .toThrow(/Unsafe URL scheme/);
  });

  // --- Loopback / localhost ---
  it('rejects http://localhost/', () => {
    expect(() => assertSafeFetchUrl('http://localhost/'))
      .toThrow(/loopback/);
  });

  it('rejects http://127.0.0.1/', () => {
    expect(() => assertSafeFetchUrl('http://127.0.0.1/'))
      .toThrow(/private\/link-local\/loopback/);
  });

  it('rejects http://127.255.255.255/', () => {
    expect(() => assertSafeFetchUrl('http://127.255.255.255/'))
      .toThrow(/private\/link-local\/loopback/);
  });

  // --- Cloud metadata / link-local ---
  it('rejects http://169.254.169.254/', () => {
    expect(() => assertSafeFetchUrl('http://169.254.169.254/latest/meta-data/'))
      .toThrow(/private\/link-local\/loopback/);
  });

  // --- Private ranges ---
  it('rejects http://10.0.0.5/', () => {
    expect(() => assertSafeFetchUrl('http://10.0.0.5/'))
      .toThrow(/private\/link-local\/loopback/);
  });

  it('rejects http://192.168.1.1/', () => {
    expect(() => assertSafeFetchUrl('http://192.168.1.1/'))
      .toThrow(/private\/link-local\/loopback/);
  });

  it('rejects http://172.16.0.1/', () => {
    expect(() => assertSafeFetchUrl('http://172.16.0.1/'))
      .toThrow(/private\/link-local\/loopback/);
  });

  it('rejects http://172.31.255.255/', () => {
    expect(() => assertSafeFetchUrl('http://172.31.255.255/'))
      .toThrow(/private\/link-local\/loopback/);
  });

  // --- Wildcard / any-address ---
  it('rejects http://0.0.0.0/', () => {
    expect(() => assertSafeFetchUrl('http://0.0.0.0/'))
      .toThrow(/loopback\/wildcard/);
  });

  // --- IPv6 literals ---
  it('rejects http://[::1]/ (IPv6 loopback)', () => {
    expect(() => assertSafeFetchUrl('http://[::1]/'))
      .toThrow(/private\/link-local\/loopback/);
  });

  it('rejects http://[::]/ (IPv6 unspecified)', () => {
    expect(() => assertSafeFetchUrl('http://[::]/'))
      .toThrow(/loopback\/wildcard|private\/link-local\/loopback/);
  });

  // --- Invalid URL ---
  it('rejects a completely invalid URL', () => {
    expect(() => assertSafeFetchUrl('not-a-url'))
      .toThrow(/Invalid URL/);
  });
});

describe('isUnsafeIp', () => {
  // --- IPv4 loopback ---
  it('flags 127.0.0.1 as unsafe', () => {
    expect(isUnsafeIp('127.0.0.1')).toBe(true);
  });
  it('flags 127.255.255.255 as unsafe', () => {
    expect(isUnsafeIp('127.255.255.255')).toBe(true);
  });

  // --- IPv4 private 10.0.0.0/8 ---
  it('flags 10.0.0.1 as unsafe', () => {
    expect(isUnsafeIp('10.0.0.1')).toBe(true);
  });
  it('flags 10.255.255.255 as unsafe', () => {
    expect(isUnsafeIp('10.255.255.255')).toBe(true);
  });

  // --- IPv4 private 172.16.0.0/12 edges ---
  it('flags 172.16.0.0 as unsafe (low edge of /12)', () => {
    expect(isUnsafeIp('172.16.0.0')).toBe(true);
  });
  it('flags 172.31.255.255 as unsafe (high edge of /12)', () => {
    expect(isUnsafeIp('172.31.255.255')).toBe(true);
  });
  it('treats 172.15.255.255 as PUBLIC (outside /12)', () => {
    expect(isUnsafeIp('172.15.255.255')).toBe(false);
  });
  it('treats 172.32.0.0 as PUBLIC (outside /12)', () => {
    expect(isUnsafeIp('172.32.0.0')).toBe(false);
  });

  // --- IPv4 private 192.168.0.0/16 ---
  it('flags 192.168.1.1 as unsafe', () => {
    expect(isUnsafeIp('192.168.1.1')).toBe(true);
  });
  it('treats 192.169.1.1 as PUBLIC', () => {
    expect(isUnsafeIp('192.169.1.1')).toBe(false);
  });

  // --- IPv4 link-local 169.254.0.0/16 ---
  it('flags 169.254.169.254 (AWS metadata) as unsafe', () => {
    expect(isUnsafeIp('169.254.169.254')).toBe(true);
  });
  it('treats 169.253.0.1 as PUBLIC (outside link-local)', () => {
    expect(isUnsafeIp('169.253.0.1')).toBe(false);
  });

  // --- IPv4 wildcard ---
  it('flags 0.0.0.0 as unsafe', () => {
    expect(isUnsafeIp('0.0.0.0')).toBe(true);
  });

  // --- IPv4 public ---
  it('treats 8.8.8.8 as PUBLIC', () => {
    expect(isUnsafeIp('8.8.8.8')).toBe(false);
  });
  it('treats 1.1.1.1 as PUBLIC', () => {
    expect(isUnsafeIp('1.1.1.1')).toBe(false);
  });
  it('treats 142.250.80.46 (google) as PUBLIC', () => {
    expect(isUnsafeIp('142.250.80.46')).toBe(false);
  });

  // --- IPv6 ---
  it('flags ::1 as unsafe', () => {
    expect(isUnsafeIp('::1')).toBe(true);
  });
  it('flags :: as unsafe', () => {
    expect(isUnsafeIp('::')).toBe(true);
  });
  it('flags fc00::1 (ULA) as unsafe', () => {
    expect(isUnsafeIp('fc00::1')).toBe(true);
  });
  it('flags fd12:3456::1 (ULA) as unsafe', () => {
    expect(isUnsafeIp('fd12:3456::1')).toBe(true);
  });
  it('flags fe80::1 (link-local) as unsafe', () => {
    expect(isUnsafeIp('fe80::1')).toBe(true);
  });
  it('flags ::ffff:127.0.0.1 (IPv4-mapped loopback) as unsafe', () => {
    expect(isUnsafeIp('::ffff:127.0.0.1')).toBe(true);
  });
  it('treats ::ffff:8.8.8.8 (IPv4-mapped public) as PUBLIC', () => {
    expect(isUnsafeIp('::ffff:8.8.8.8')).toBe(false);
  });
  it('treats 2606:4700:4700::1111 (Cloudflare DNS) as PUBLIC', () => {
    expect(isUnsafeIp('2606:4700:4700::1111')).toBe(false);
  });

  // --- Not an IP literal ---
  it('returns false for non-IP strings (caller responsibility)', () => {
    expect(isUnsafeIp('example.com')).toBe(false);
    expect(isUnsafeIp('not-an-ip')).toBe(false);
    expect(isUnsafeIp('')).toBe(false);
  });
});

// Build a fake `lookup` whose return type matches `dns.promises.lookup` with
// `{ all: true }` (i.e. LookupAddress[]).
function makeLookup(addrs: LookupAddress[]) {
  // We only ever call lookup(host, { all: true }) so this signature is enough.
  // Cast through unknown because the real overload union is wide.
  return ((_host: string, _opts: { all: true }) =>
    Promise.resolve(addrs)) as unknown as typeof import('node:dns').promises.lookup;
}

describe('assertResolvedIpSafe', () => {
  it('passes when all resolved addresses are public IPv4', async () => {
    const lookup = makeLookup([{ address: '8.8.8.8', family: 4 }]);
    await expect(assertResolvedIpSafe('dns.google', lookup)).resolves.toBeUndefined();
  });

  it('passes when all resolved addresses are public IPv6', async () => {
    const lookup = makeLookup([{ address: '2606:4700:4700::1111', family: 6 }]);
    await expect(assertResolvedIpSafe('cloudflare-dns.com', lookup)).resolves.toBeUndefined();
  });

  it('throws when resolved address is loopback (127.0.0.1)', async () => {
    const lookup = makeLookup([{ address: '127.0.0.1', family: 4 }]);
    await expect(assertResolvedIpSafe('rebind.example', lookup)).rejects.toThrow(
      /private\/loopback\/link-local/,
    );
  });

  it('throws when resolved address is link-local cloud-metadata (169.254.169.254)', async () => {
    const lookup = makeLookup([{ address: '169.254.169.254', family: 4 }]);
    await expect(assertResolvedIpSafe('metadata.rebind', lookup)).rejects.toThrow(
      /private\/loopback\/link-local/,
    );
  });

  it('throws when resolved address is a private 10.0.0.0/8 IP', async () => {
    const lookup = makeLookup([{ address: '10.1.2.3', family: 4 }]);
    await expect(assertResolvedIpSafe('intranet.rebind', lookup)).rejects.toThrow(
      /private\/loopback\/link-local/,
    );
  });

  it('throws when resolved address is IPv6 loopback (::1)', async () => {
    const lookup = makeLookup([{ address: '::1', family: 6 }]);
    await expect(assertResolvedIpSafe('ipv6.rebind', lookup)).rejects.toThrow(
      /private\/loopback\/link-local/,
    );
  });

  it('throws when ANY of several resolved addresses is unsafe (mixed answer)', async () => {
    const lookup = makeLookup([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ]);
    await expect(assertResolvedIpSafe('mixed.rebind', lookup)).rejects.toThrow(
      /private\/loopback\/link-local/,
    );
  });

  it('passes through when EVERY resolved address is public (multi-record)', async () => {
    const lookup = makeLookup([
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    await expect(assertResolvedIpSafe('multi.public', lookup)).resolves.toBeUndefined();
  });

  it('short-circuits (does not call lookup) for IP literals', async () => {
    let called = 0;
    const lookup = ((_h: string, _o: { all: true }) => {
      called++;
      return Promise.resolve([] as LookupAddress[]);
    }) as unknown as typeof import('node:dns').promises.lookup;
    await expect(assertResolvedIpSafe('8.8.8.8', lookup)).resolves.toBeUndefined();
    expect(called).toBe(0);
  });

  it('wraps lookup errors with a clear message', async () => {
    const lookup = ((_h: string, _o: { all: true }) =>
      Promise.reject(new Error('ENOTFOUND'))) as unknown as typeof import('node:dns').promises.lookup;
    await expect(assertResolvedIpSafe('nonexistent.invalid', lookup)).rejects.toThrow(
      /Could not resolve hostname/,
    );
  });
});
