// src/lib/source/__tests__/diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffLines } from '@/lib/source/diff';

describe('diffLines', () => {
  it('marks unchanged lines as context', () => {
    const d = diffLines('a\nb', 'a\nb');
    expect(d.map((l) => l.kind)).toEqual(['context', 'context']);
  });

  it('marks an added line', () => {
    const d = diffLines('a', 'a\nb');
    expect(d).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });

  it('marks a removed line', () => {
    const d = diffLines('a\nb', 'a');
    expect(d).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'remove', text: 'b' },
    ]);
  });

  it('handles a replaced line as remove then add', () => {
    const d = diffLines('a\nx\nc', 'a\ny\nc');
    expect(d).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'remove', text: 'x' },
      { kind: 'add', text: 'y' },
      { kind: 'context', text: 'c' },
    ]);
  });

  it('treats empty-old as all additions', () => {
    const d = diffLines('', 'a\nb');
    expect(d).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });
});
