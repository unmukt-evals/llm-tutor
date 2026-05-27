// src/lib/reader/diagram-renderer.ts
// Pure dispatch for DiagramPane: maps a Diagram.kind to the renderer the
// component should use. Diagrams arrive ALREADY classified by the parser
// (src/lib/ingest/parse-module.ts) as { kind: 'mermaid' | 'ascii' | 'code'; body }
// — DiagramPane does NOT re-infer kind from fences. This helper is the single
// place that decides which of the three render paths a Diagram takes, so it can
// be unit-tested under the existing node/Vitest config (no jsdom needed).

import type { Diagram } from '@/lib/types';

export type DiagramRenderer = 'mermaid' | 'shiki' | 'pre';

/**
 * Decide how to render a Diagram, by its parser-assigned kind:
 *   - 'mermaid' → render via the mermaid library (SVG)
 *   - 'code'    → syntax-highlight via shiki
 *   - 'ascii'   → render verbatim in a <pre> (monospace), no highlighting
 *
 * The parser strips the fence language tag, so a 'code' Diagram carries no
 * per-language info — shiki is therefore invoked with lang:'text'.
 */
export function rendererFor(kind: Diagram['kind']): DiagramRenderer {
  switch (kind) {
    case 'mermaid':
      return 'mermaid';
    case 'code':
      return 'shiki';
    case 'ascii':
      return 'pre';
  }
}
