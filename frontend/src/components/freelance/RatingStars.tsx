'use client';

/**
 * Read-only star rating with an optional count. Shared across the talent card,
 * profile detail, and hires review UI so ratings render identically everywhere.
 */
export function RatingStars({ rating, count, size = 13 }: { rating?: number | null; count?: number; size?: number }) {
  if (rating == null) return null;
  const rounded = Math.round(rating);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: size, lineHeight: 1 }} aria-label={`${rating} out of 5`}>
      <span style={{ color: 'var(--warning-fg, #f59e0b)' }} aria-hidden>
        {'★'.repeat(rounded)}{'☆'.repeat(Math.max(0, 5 - rounded))}
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: size - 1 }}>{rating.toFixed(1)}{count != null && count > 0 ? ` (${count})` : ''}</span>
    </span>
  );
}
