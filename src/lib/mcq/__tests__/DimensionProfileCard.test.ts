// src/lib/mcq/__tests__/DimensionProfileCard.test.ts
// Unit tests for the statusConfig helper exported from DimensionProfileCard.
//
// The component itself is pure presentational (no logic beyond statusConfig),
// so a render test adds brittle setup cost without coverage benefit.
// Testing the helper here is sufficient: it is the only logic in the file.

import { describe, it, expect } from 'vitest';
import { statusConfig } from '@/components/DimensionProfileCard';
import type { DimensionStatus } from '@/lib/types';

describe('statusConfig', () => {
  it.each<[DimensionStatus, string, string]>([
    ['solid',    'Solid',    'green'],
    ['fuzzy',    'Fuzzy',    'yellow'],
    ['weak',     'Weak',     'red'],
    ['untested', 'Untested', 'gray'],
  ])('status "%s" → label "%s" with "%s" colour class', (status, expectedLabel, colorHint) => {
    const cfg = statusConfig(status);
    expect(cfg.label).toBe(expectedLabel);
    expect(cfg.className).toContain(colorHint);
    // description must be a non-empty string
    expect(typeof cfg.description).toBe('string');
    expect(cfg.description.length).toBeGreaterThan(0);
  });

  it('covers every DimensionStatus — no missing branch', () => {
    const statuses: DimensionStatus[] = ['solid', 'fuzzy', 'weak', 'untested'];
    for (const s of statuses) {
      expect(() => statusConfig(s)).not.toThrow();
    }
  });
});
