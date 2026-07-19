'use client';

/**
 * QR code renderer — turns a string into an SVG matrix via the local encoder.
 *
 * Rendered on a fixed white plate with dark modules in BOTH themes on purpose:
 * scanners need a light quiet zone and high contrast, so inverting this in dark
 * mode would make it harder to scan. The plate itself is what adapts — it reads
 * as a deliberate light card on a dark surface rather than an unstyled block.
 */

import { useMemo } from 'react';
import { encodeQr } from '@/lib/qr';

interface QrCodeProps {
  /** The value to encode (a URL, in practice). */
  value: string;
  /** Rendered edge length in pixels, including the quiet zone. */
  size?: number;
  /** Accessible label for the code. */
  label: string;
}

/** Modules of margin the spec requires around the symbol. */
const QUIET_ZONE = 4;

export function QrCode({ value, size = 180, label }: QrCodeProps) {
  const qr = useMemo(() => encodeQr(value), [value]);

  // Payloads beyond the encoder's version-10 ceiling can't be drawn. Showing the
  // raw value beats rendering a code that won't scan.
  if (!qr) {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 10,
          border: '1px dashed var(--border-subtle, #d4d4d8)',
          color: 'var(--text-muted, #71717a)',
          fontSize: 12,
          wordBreak: 'break-all',
          fontFamily: 'var(--font-mono, monospace)',
        }}
      >
        {value}
      </div>
    );
  }

  const total = qr.size + QUIET_ZONE * 2;
  // One path of module-sized rects keeps the DOM to a single node.
  const path = qr.modules
    .flatMap((row, r) =>
      row.map((dark, c) => (dark ? `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z` : '')),
    )
    .join('');

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      style={{
        background: '#ffffff',
        borderRadius: 10,
        padding: 0,
        maxWidth: '100%',
        height: 'auto',
        display: 'block',
      }}
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
