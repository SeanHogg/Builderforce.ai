/** Shared number formatting for the insight lenses (DRY — used by every lens). */

export const usd = (n: number | null | undefined): string =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export const pct = (n: number | null | undefined): string =>
  n == null ? '—' : `${n.toFixed(0)}%`;

export const hrs = (n: number | null | undefined): string =>
  n == null ? '—' : `${n.toFixed(1)}h`;

export const days = (n: number | null | undefined): string =>
  n == null ? '—' : `${n.toFixed(1)}d`;

export const score2 = (n: number | null | undefined): string =>
  n == null ? '—' : n.toFixed(2);

export const int = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString();

/** Compact token/unit count: 1_240_000 → "1.2M", 12_400 → "12.4K". The single
 *  source of truth for token formatting across the AI-usage surfaces. */
export const compactTokens = (n: number | null | undefined): string => {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
};
