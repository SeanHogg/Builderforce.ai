'use client';

import React, { useId } from 'react';
import styles from './Skeletons.module.css';

/**
 * ShimmerPrimitive — a reusable shimmer/placeholder for async regions.
 * Displays a pulsating gradient animation during loading without layout shift.
 * Compliant with FR-2 (skeleton shape matches content), FR-6 (aria-busy, role, reduced-motion).
 */
export function ShimmerPrimitive({
  className,
  width = '100%',
  height = '100%',
  borderRadius,
}: {
  className?: string;
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
}) {
  const style: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius:
      borderRadius != null
        ? typeof borderRadius === 'number'
          ? `${borderRadius}px`
          : borderRadius
        : undefined,
  };

  return (
    <div
      className={`${styles.shimmer} ${className ?? ''}`}
      style={style}
      aria-busy="true"
      role="status"
    >
      <div className={styles.shimmerPseudo} />
    </div>
  );
}

/**
 * LineShimmer — a vertical stacked shimmer simulating text rows.
 * Widths are derived from a deterministic seed to avoid CLS-causing re-renders.
 */
export function LineShimmer({ count = 3, gap = 8 }: { count?: number; gap?: number }) {
  const seed = useId();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        width: '100%',
      }}
      aria-busy="true"
      role="status"
    >
      {Array.from({ length: count }).map((_, i) => {
        // Deterministic widths based on index + seed to avoid re-render jitter.
        const widths = ['100%', '85%', '92%', '78%', '95%', '88%', '72%', '90%'];
        return (
          <ShimmerPrimitive
            key={`${seed}-${i}`}
            height={16}
            width={widths[i % widths.length]}
          />
        );
      })}
    </div>
  );
}

/**
 * BoxShimmer — a rectangular block with rounded corners simulating a component/card.
 */
export function BoxShimmer({ dimension = 160 }: { dimension?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dimension,
        height: dimension,
      }}
      aria-busy="true"
      role="status"
    >
      <ShimmerPrimitive width={dimension} height={dimension} borderRadius={12} />
    </div>
  );
}

/**
 * DelimitedShimmer — combines row and box patterns with minimal layout shift.
 */
export function DelimitedShimmer({
  dimensions = [160, 160],
}: {
  dimensions?: [number, number];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <BoxShimmer dimension={dimensions[0]} />
      <LineShimmer count={2} />
      <BoxShimmer dimension={dimensions[1]} />
    </div>
  );
}

/**
 * AvatarShimmer — circular shimmer for user avatars.
 */
export function AvatarShimmer({ size = 40 }: { size?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
      }}
      aria-busy="true"
      role="status"
    >
      <ShimmerPrimitive width={size} height={size} borderRadius="50%" />
    </div>
  );
}

/**
 * TextShimmer — a linear text row with configurable width.
 */
export function TextShimmer({ width = 320 }: { width?: number }) {
  return <ShimmerPrimitive height={16} width={width} />;
}

/**
 * MetricShimmer — a large-metric placeholder (headline number + subtitle).
 */
export function MetricShimmer({ width = 120 }: { width?: number }) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      aria-busy="true"
      role="status"
    >
      <ShimmerPrimitive height={36} width={width} />
      <ShimmerPrimitive height={14} width={Math.round(width * 0.6)} />
    </div>
  );
}
