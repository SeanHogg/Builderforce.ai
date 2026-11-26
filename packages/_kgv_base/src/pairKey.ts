/**
 * The ONE packing of two small non-negative integers (indices numbered from 0, far below `PAIR_SPAN`) into one number,
 * so a Set / Map of pairs hashes a number instead of a string or an object.
 */

/** The multiplier: 2^26, so a pair of indices below it stays an exact integer (under 2^53). */
export const PAIR_SPAN = 2 ** 26;

/** The ordered pair (a, b): (a, b) and (b, a) are different keys. */
export const pairKey = (a: number, b: number): number => a * PAIR_SPAN + b;

/** The unordered pair: smaller index first, so (a, b) and (b, a) are the same key. */
export const unorderedPairKey = (a: number, b: number): number => (a < b ? pairKey(a, b) : pairKey(b, a));
