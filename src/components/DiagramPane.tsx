// src/components/DiagramPane.tsx
// Renders a module's Diagram[] (the engineer-pass fenced blocks the parser
// already classified). Each Diagram arrives as { kind, body } — DiagramPane
// does NOT re-infer kind from fences. Rendering, decided by rendererFor():
//   - kind 'mermaid' → mermaid → SVG (lazy-imported; render errors fall back
//                      to showing the raw body, never throw)
//   - kind 'code'    → shiki syntax highlight (lazy-imported; lang:'text'
//                      because the parser strips the fence language tag)
//   - kind 'ascii'   → verbatim <pre>, no highlighting
//
// Must be 'use client': mermaid.render() and shiki both need the browser, and
// both libs are dynamic-imported inside effects so they stay out of the SSR /
// initial bundle.
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Diagram } from '@/lib/types';
import { rendererFor } from '@/lib/reader/diagram-renderer';

interface DiagramPaneProps {
  /** Diagrams already classified by the parser (Module.diagrams). */
  diagrams: Diagram[];
}

// ── Mermaid block ──────────────────────────────────────────────────────────
// Lazy-imports mermaid, renders to SVG. Any failure (invalid syntax, missing
// browser API) is caught and the raw source is shown in a <pre> instead — the
// component never throws.
function MermaidBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    async function render() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (failed) {
    // Graceful fallback: show the raw diagram source rather than break the page.
    return (
      <pre className="my-4 overflow-x-auto rounded bg-slate-100 p-3 text-xs text-slate-700">
        {source}
      </pre>
    );
  }
  return <div ref={ref} className="my-4 overflow-x-auto" />;
}

// ── Shiki code block ─────────────────────────────────────────────────────────
// Lazy-imports shiki. The parser discards the fence language tag, so we
// highlight as plain text; a failure falls back to an escaped <pre>.
function ShikiBlock({ source }: { source: string }) {
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function highlight() {
      try {
        const { codeToHtml } = await import('shiki');
        const result = await codeToHtml(source, {
          lang: 'text',
          theme: 'github-light',
        });
        if (!cancelled) setHtml(result);
      } catch {
        if (!cancelled) setHtml('');
      }
    }
    highlight();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (html) {
    return (
      <div
        className="my-4 overflow-x-auto rounded text-sm"
        // shiki returns escaped, trusted HTML built from the source string.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  // Pre-highlight (and fallback) state: render the raw source safely as text.
  return (
    <pre className="my-4 overflow-x-auto rounded bg-slate-100 p-3 text-sm text-slate-700">
      {source}
    </pre>
  );
}

// ── Ascii block ──────────────────────────────────────────────────────────────
// Verbatim monospace, no highlighting — body is rendered as text (React escapes).
function AsciiBlock({ source }: { source: string }) {
  return (
    <pre className="my-4 overflow-x-auto rounded bg-slate-100 p-3 font-mono text-sm text-slate-700">
      {source}
    </pre>
  );
}

// ── DiagramPane ────────────────────────────────────────────────────────────
export default function DiagramPane({ diagrams }: DiagramPaneProps) {
  if (diagrams.length === 0) return null;

  return (
    <aside className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Diagrams &amp; Code
      </h3>
      {diagrams.map((diagram, i) => {
        switch (rendererFor(diagram.kind)) {
          case 'mermaid':
            return <MermaidBlock key={i} source={diagram.body} />;
          case 'shiki':
            return <ShikiBlock key={i} source={diagram.body} />;
          case 'pre':
            return <AsciiBlock key={i} source={diagram.body} />;
        }
      })}
    </aside>
  );
}
