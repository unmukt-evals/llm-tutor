import { describe, it, expect } from 'vitest';
import { moduleRefHref } from '@/lib/mcq/remediation-link';

describe('moduleRefHref', () => {
  it('builds a pass-only href when there is no anchor', () => {
    expect(moduleRefHref('M03', { pass: 'engineer', label: 'Re-learn' })).toBe(
      '/module/M03?pass=engineer',
    );
  });

  it('appends a github-style slug of the anchor heading text', () => {
    expect(
      moduleRefHref('M03', { pass: 'engineer', anchor: 'Why context dilutes', label: 'x' }),
    ).toBe('/module/M03?pass=engineer#why-context-dilutes');
  });

  it('slugifies punctuation the way rehype-slug does', () => {
    expect(
      moduleRefHref('B01', { pass: 'operator', anchor: 'Fairness & failure attribution', label: 'x' }),
    ).toBe('/module/B01?pass=operator#fairness--failure-attribution');
  });

  it('keeps dotted module ids intact', () => {
    expect(moduleRefHref('M0.5', { pass: 'operator', label: 'x' })).toBe(
      '/module/M0.5?pass=operator',
    );
  });
});
