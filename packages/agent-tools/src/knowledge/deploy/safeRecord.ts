/**
 * knowledge/deploy/safeRecord.ts — the ONE way the descriptor readers build and read keyed records from untrusted
 * text: prototype-free objects (`Object.create(null)`), keys that would reach a prototype (`__proto__`, `constructor`,
 * `prototype`) refused, own keys only. Also the loose value readers (`obj` / `arr` / `str`) every parser shares. Pure.
 */

export type SafeRecord<V> = { [key: string]: V };

/** Keys never written into a parsed record. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
export const isSafeKey = (key: string): boolean => !FORBIDDEN.has(key);

export const record = <V>(): SafeRecord<V> => Object.create(null) as SafeRecord<V>;

/** `target[key] = value` unless the key is forbidden. */
export function setKey<V>(target: SafeRecord<V>, key: string, value: V): void {
    if (isSafeKey(key)) target[key] = value;
}

/** The own value at `key` (never an inherited one). */
export const own = (target: object, key: string): unknown => (Object.hasOwn(target, key) ? (target as Record<string, unknown>)[key] : undefined);

type Obj = Record<string, unknown>;
/** A plain record view of `v` (arrays and scalars read as empty). */
export const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : record<unknown>());
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** A scalar as text: strings as they are, numbers and booleans spelled out. */
export const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
/** The own field `key` of `v`, read loosely. */
export const field = (v: unknown, key: string): unknown => own(obj(v), key);
