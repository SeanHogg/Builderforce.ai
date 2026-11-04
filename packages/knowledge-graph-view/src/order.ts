/** The ONE string comparator and the ONE 1e-4 rounding every pure model here uses, so ordering and coordinates agree byte for byte. */

export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const round = (n: number): number => Math.round(n * 1e4) / 1e4;
