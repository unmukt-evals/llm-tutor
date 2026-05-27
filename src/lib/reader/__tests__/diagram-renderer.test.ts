import { describe, it, expect } from 'vitest';
import { rendererFor } from '@/lib/reader/diagram-renderer';

describe('rendererFor', () => {
  it("dispatches kind 'mermaid' to the mermaid renderer", () => {
    expect(rendererFor('mermaid')).toBe('mermaid');
  });

  it("dispatches kind 'code' to shiki", () => {
    expect(rendererFor('code')).toBe('shiki');
  });

  it("dispatches kind 'ascii' to a plain <pre>", () => {
    expect(rendererFor('ascii')).toBe('pre');
  });
});
