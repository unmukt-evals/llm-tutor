import { describe, it, expect } from 'vitest';
import { deepSet } from '../deep-set';

describe('deepSet', () => {
  it('sets a top-level key', () => {
    const out = deepSet({ a: 1 }, ['b'], 2);
    expect(out).toEqual({ a: 1, b: 2 });
  });

  it('sets a nested key, creating intermediate objects', () => {
    const out = deepSet({}, ['modules', 'B01', 'mastery'], 'solid');
    expect(out).toEqual({ modules: { B01: { mastery: 'solid' } } });
  });

  it('overwrites an existing nested key while preserving siblings', () => {
    const input = {
      modules: { B01: { mastery: 'fuzzy', extra: 'keep' }, B02: { mastery: 'blank' } },
      xp: { total: 5 },
    };
    const out = deepSet(input, ['modules', 'B01', 'mastery'], 'verified');
    expect(out).toEqual({
      modules: { B01: { mastery: 'verified', extra: 'keep' }, B02: { mastery: 'blank' } },
      xp: { total: 5 },
    });
  });

  it('does not mutate the input object or its nested objects', () => {
    const input = { modules: { B01: { mastery: 'fuzzy' } } };
    const out = deepSet(input, ['modules', 'B01', 'mastery'], 'solid');
    expect(input.modules.B01.mastery).toBe('fuzzy');
    expect(out).not.toBe(input);
    expect((out as typeof input).modules).not.toBe(input.modules);
    expect((out as typeof input).modules.B01).not.toBe(input.modules.B01);
  });

  it('replaces the whole document for an empty path', () => {
    const replacement = { version: 1 };
    expect(deepSet({ a: 1 }, [], replacement)).toBe(replacement);
  });

  it('replaces a non-object intermediate value with an object', () => {
    const out = deepSet({ a: 5 }, ['a', 'b'], 9);
    expect(out).toEqual({ a: { b: 9 } });
  });

  it('treats a null/non-object root as an empty object', () => {
    const out = deepSet(null as unknown as Record<string, unknown>, ['x'], 1);
    expect(out).toEqual({ x: 1 });
  });

  it('sets a value of arbitrary type (array)', () => {
    const out = deepSet({}, ['sessionLog'], [{ module: 'B01', at: 'now', events: [] }]);
    expect(out).toEqual({ sessionLog: [{ module: 'B01', at: 'now', events: [] }] });
  });

  // Prototype-pollution defense: unsafe keys must throw, never silently write.
  it('throws for __proto__ in path', () => {
    expect(() => deepSet({}, ['__proto__', 'x'], 1)).toThrow('deepSet: unsafe key');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('throws for constructor in path', () => {
    expect(() => deepSet({}, ['constructor'], 1)).toThrow('deepSet: unsafe key');
  });

  it('throws for prototype nested in path', () => {
    expect(() => deepSet({}, ['a', 'prototype', 'b'], 1)).toThrow('deepSet: unsafe key');
  });

  it('does not pollute Object.prototype after rejected path', () => {
    try { deepSet({}, ['__proto__', 'polluted'], true); } catch { /* expected */ }
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});
