import { describe, it, expect } from 'vitest';
import { animationEnabled, motionDurationMs } from '@/lib/ui/motion';

describe('animationEnabled', () => {
  it('is true when the user does NOT prefer reduced motion', () => {
    expect(animationEnabled(false)).toBe(true);
  });

  it('is false when the user prefers reduced motion', () => {
    expect(animationEnabled(true)).toBe(false);
  });
});

describe('motionDurationMs', () => {
  it('returns the requested duration when motion is enabled', () => {
    expect(motionDurationMs(400, false)).toBe(400);
  });

  it('collapses to 0ms when the user prefers reduced motion', () => {
    expect(motionDurationMs(400, true)).toBe(0);
  });
});
