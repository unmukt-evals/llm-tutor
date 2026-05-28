// src/components/ProgressRing.tsx
// Presentational SVG progress ring. ALL logic lives in pure tested helpers:
//   ringVisual  (mastery → fraction/color/label)
//   ringGeometry(radius, fraction → dasharray/offset)
//   motion      (reduced-motion gate)
// The arc animates its stroke-dashoffset via a CSS transition; reduced motion
// collapses the duration to 0ms. (V1 spec §1: animated rings, distinct
// open-diagnosis state, prefers-reduced-motion respected.)
'use client';

import { useEffect, useState } from 'react';
import type { Mastery } from '@/lib/types';
import { ringVisual, ringGeometry, RING_COLORS } from '@/lib/ui/progress-ring';
import { motionDurationMs, prefersReducedMotion } from '@/lib/ui/motion';

interface ProgressRingProps {
  mastery: Mastery;
  openDiagnosis?: boolean;
  /** Outer pixel size of the square SVG. */
  size?: number;
  strokeWidth?: number;
}

export default function ProgressRing({
  mastery,
  openDiagnosis = false,
  size = 24,
  strokeWidth = 3,
}: ProgressRingProps) {
  // Detect reduced-motion after mount (matchMedia is browser-only). Default to
  // animating; collapse to 0ms if the user prefers reduced motion.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(prefersReducedMotion());
  }, []);

  const { fraction, color, label } = ringVisual(mastery, openDiagnosis);
  const radius = size / 2 - strokeWidth;
  const { circumference, dashOffset } = ringGeometry(radius, fraction);
  const durationMs = motionDurationMs(500, reduced);
  const center = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Progress: ${label}`}
      data-testid="progress-ring"
      className="shrink-0"
    >
      {/* faint track */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={RING_COLORS.blank}
        strokeOpacity={0.35}
        strokeWidth={strokeWidth}
      />
      {/* progress arc — rotated -90deg so it starts at 12 o'clock */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: `stroke-dashoffset ${durationMs}ms ease-out, stroke ${durationMs}ms ease-out` }}
      />
    </svg>
  );
}
