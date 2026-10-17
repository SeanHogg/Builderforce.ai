/**
 * Number formatting for the spend readouts — locale-aware (`Intl`), and honest at the
 * small end: a conversation that cost a fifth of a cent reads "<$0.01", never "$0.00",
 * which would claim it was free.
 */

export function formatUsd(usd: number, locale?: string): string {
  const abs = Math.abs(usd);
  if (abs > 0 && abs < 0.01) {
    const tiny = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(0.01);
    return `${usd < 0 ? '−' : ''}<${tiny}`;
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: abs >= 100 ? 0 : 2,
  }).format(usd);
}

export function formatTokens(tokens: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);
}

export function formatPct(fraction: number): string {
  return String(Math.round(fraction * 100));
}

/** `{name}` placeholder substitution — the ONE every brain-ui label bundle fills with
 *  (spend, the on-device list, the Evermind console, the chat-tickets rail). A name the
 *  values lack is left as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}
