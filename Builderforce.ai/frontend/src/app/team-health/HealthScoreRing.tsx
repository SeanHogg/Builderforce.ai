'use client';

/**
 * HealthScoreRing — an SVG donut ring showing the Team Health Score (0–100).
 *
 * Green >= 80, yellow 50–79, red < 50. The ring animates on mount.
 * Sized to fit inline in the dashboard header.
 */

import { useEffect, useState } from 'react';

const SIZE = 72;
const STROKE = 7;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface Props {
  score: number;
  /** Optional label inside the ring (defaults to score string). */
  label?: string;
  size?: number;
}

export function HealthScoreRing({ score, label, size = SIZE }: Props) {
  const [offset, setOffset] = useState(CIRCUMFERENCE);

  useEffect(() => {
    // Animate on mount / score change
    const clamped = Math.max(0, Math.min(100, score));
    const target = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;
    // Simple single-frame transition
    const id = requestAnimationFrame(() => setOffset(target));
    return () => cancelAnimationFrame(id);
  }, [score]);

  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped >= 80 ? 'var(--th-green)' : clamped >= 50 ? 'var(--th-aging)' : 'var(--th-blocker)';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Team Health Score: ${clamped} out of 100`}
      style={{ flexShrink: 0 }}
    >
      {/* Background track */}
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="var(--bg-elevated)"
        strokeWidth={STROKE}
      />
      {/* Foreground arc */}
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease' }}
      />
      {/* Centre text */}
      <text
        x={SIZE / 2}
        y={SIZE / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{
          fontSize: '1.05rem',
          fontWeight: 700,
          fill: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {label ?? clamped}
      </text>
    </svg>
  );
}
