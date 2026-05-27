// src/components/DepthToggle.tsx
// Three-button depth-pass toggle (Dumb it down / Engineer / Make it matter).
// Purely presentational — the label→DepthPass mapping and default live in the
// tested pure helper (src/lib/reader/select-pass.ts); this component just binds
// clicks to onChange and reflects the active selection.
'use client';

import { DEPTH_OPTIONS } from '@/lib/reader/select-pass';
import type { DepthPass } from '@/lib/types';

interface DepthToggleProps {
  /** Currently selected depth pass. */
  current: DepthPass;
  /** Fired with the chosen DepthPass key when a button is clicked. */
  onChange: (key: DepthPass) => void;
  /**
   * Optional per-pass authored map. When provided, a depth whose pass is NOT
   * authored is visually marked (dimmed + "not authored" title). It stays
   * clickable so the reader can still surface the "not authored yet" state.
   * Omit to treat all depths as available.
   */
  availability?: Partial<Record<DepthPass, boolean>>;
}

export default function DepthToggle({ current, onChange, availability }: DepthToggleProps) {
  return (
    <div
      role="group"
      aria-label="Reading depth"
      className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium"
    >
      {DEPTH_OPTIONS.map(({ label, key }) => {
        const active = current === key;
        // Undefined availability = treat as authored (no visual marking).
        const authored = availability ? availability[key] !== false : true;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            title={authored ? label : `${label} — not authored yet`}
            onClick={() => onChange(key)}
            className={[
              'px-4 py-2 transition-colors',
              active
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50',
              authored ? '' : 'italic opacity-50',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {label}
            {!authored && (
              <span className="ml-1 text-xs" aria-hidden="true">
                ·
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
