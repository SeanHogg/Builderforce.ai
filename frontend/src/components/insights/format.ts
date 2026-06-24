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
