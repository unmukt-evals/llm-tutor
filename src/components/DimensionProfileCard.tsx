// src/components/DimensionProfileCard.tsx
// Dimension-profile card (plan-03 Task 12).
//
// Pure presentational — no state, no fetch.
// Renders all 4 dimensions (topic / logic / example / extension) with their
// DimensionStatus (solid / fuzzy / weak / untested).
//
// Accessible: status is communicated via text badge AND colour so it is
// never colour-only. Each row carries an aria-label combining the dimension
// name with its status.

import type { DimensionProfile, Dimension, DimensionStatus } from '@/lib/types';

// ── status helper (pure — exported so it can be unit-tested) ─────────────────

export interface StatusConfig {
  label: string;          // human-readable badge text
  className: string;      // Tailwind utility classes for the badge
  description: string;    // one-line plain-English meaning
}

export function statusConfig(status: DimensionStatus): StatusConfig {
  switch (status) {
    case 'solid':
      return {
        label: 'Solid',
        className: 'bg-green-100 text-green-800',
        description: '≥ 80 % accuracy',
      };
    case 'fuzzy':
      return {
        label: 'Fuzzy',
        className: 'bg-yellow-100 text-yellow-800',
        description: '60 – 79 % accuracy',
      };
    case 'weak':
      return {
        label: 'Weak',
        className: 'bg-red-100 text-red-800',
        description: '< 60 % accuracy',
      };
    case 'untested':
      return {
        label: 'Untested',
        className: 'bg-gray-100 text-gray-500',
        description: 'No answers yet',
      };
  }
}

// ── dimension metadata ────────────────────────────────────────────────────────

const DIMENSION_META: Record<Dimension, { label: string; hint: string }> = {
  topic:     { label: 'Topic',     hint: 'Core concept recall' },
  logic:     { label: 'Logic',     hint: 'Causal / structural reasoning' },
  example:   { label: 'Example',   hint: 'Concrete case recognition' },
  extension: { label: 'Extension', hint: 'Transfer to new contexts' },
};

const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

// ── component ─────────────────────────────────────────────────────────────────

interface DimensionProfileCardProps {
  profile: DimensionProfile;
}

export function DimensionProfileCard({ profile }: DimensionProfileCardProps) {
  return (
    <div
      data-testid="dimension-profile-card"
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Dimension Profile
      </h3>
      <ul className="space-y-2">
        {DIMENSIONS.map((dim) => {
          const status = profile[dim];
          const cfg = statusConfig(status);
          const meta = DIMENSION_META[dim];

          return (
            <li
              key={dim}
              data-testid={`profile-${dim}`}
              aria-label={`${meta.label}: ${cfg.label}`}
              className="flex items-center justify-between"
            >
              {/* Left: dimension name + hint */}
              <span className="flex flex-col">
                <span className="text-sm font-medium text-gray-800">{meta.label}</span>
                <span className="text-xs text-gray-400">{meta.hint}</span>
              </span>

              {/* Right: status badge (text + colour) */}
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}
                title={cfg.description}
              >
                {cfg.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
