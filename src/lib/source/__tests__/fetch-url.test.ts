// src/lib/source/__tests__/fetch-url.test.ts
// Pure unit tests for assertSafeFetchUrl — no network required.
import { describe, it, expect } from 'vitest';
import { assertSafeFetchUrl } from '@/lib/source/fetch-url';

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

  // --- Invalid URL ---
  it('rejects a completely invalid URL', () => {
    expect(() => assertSafeFetchUrl('not-a-url'))
      .toThrow(/Invalid URL/);
  });
});
