'use client';

import React from 'react';
import styles from './Skeletons.module.css';

/**
 * ShimmerPrimitive — a reusable shimmer/placeholder for async regions.
 * Displays a pulsating gradient animation during loading without layout shift.
 */
export function ShimmerPrimitive({
  className,
  width,
  height,
}: {
  className?: string;
  width?: string | number;
  height?: string | number;
}) {
  const style: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };

  return (
    <div className={`${styles.shimmer} ${className || ''}`} style={style} aria-hidden aria-busy="true" role="status">
      <div className={styles.shimmerContent} />
    </div>
  );
}

/**
 * LineShimmer — a vertical stacked shimmer simulating text rows.
 */
export function LineShimmer({ count = 3, gap = 8 }: { count?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }} aria-hidden aria-busy="true" role="status">
      {Array.from({ length: count }).map((_, i) => (
        <ShimmerPrimitive key={i} height={24} width={Math.random() > 0.5 ? '100px' : '120px'} />
      ))}
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
        alignItems: 'center',
        gridColumn: `1 / -1`,
        height: 160,
      }}
      aria-hidden aria-busy="true"
      role="status"
    >
      <ShimmerPrimitive width={dimension} height={dimension} />
    </div>
  );
}

/**
 * DelimitedShimmer — combines row and box patterns with minimal layout shift.
 */
export function DelimitedShimmer({ dimensions = [160, 160] }: { dimensions?: [number, number] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <BoxShimmer dimension={dimensions[0]} />
      <LineShimmer count={2} />
      <BoxShimmer dimension={dimensions[1]} />
    </div>
  );
}

/**
 * AvatarShimmer — mini circular shimmer for user avatars.
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
      aria-hidden aria-busy="true"
      role="status"
    >
      <ShimmerPrimitive width={size} height={size} />
    </div>
  );
}

/**
 * TextShimmer — a linear text row variation with varied length to approximate line variation.
 */
export function TextShimmer({ width = 320 }: { width?: number }) {
  return (
    <ShimmerPrimitive height={16} width={Math.random() > 0.3 ? width : undefined} />
  );
}