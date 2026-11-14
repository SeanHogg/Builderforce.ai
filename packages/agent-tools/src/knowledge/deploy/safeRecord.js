/**
 * knowledge/deploy/safeRecord.ts — the ONE way the descriptor readers build and read keyed records from untrusted
 * text: prototype-free objects (`Object.create(null)`), keys that would reach a prototype (`__proto__`, `constructor`,
 * `prototype`) refused, own keys only. Also the loose value readers (`obj` / `arr` / `str`) every parser shares. Pure.
 */
/** Keys never written into a parsed record. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
export const isSafeKey = (key) => !FORBIDDEN.has(key);
export const record = () => Object.create(null);
/** `target[key] = value` unless the key is forbidden. */
export function setKey(target, key, value) {
    if (isSafeKey(key))
        target[key] = value;
}
/** The own value at `key` (never an inherited one). */
export const own = (target, key) => (Object.hasOwn(target, key) ? target[key] : undefined);
/** A plain record view of `v` (arrays and scalars read as empty). */
export const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : record());
export const arr = (v) => (Array.isArray(v) ? v : []);
/** A scalar as text: strings as they are, numbers and booleans spelled out. */
export const str = (v) => typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
/** The own field `key` of `v`, read loosely. */
export const field = (v, key) => own(obj(v), key);
//# sourceMappingURL=safeRecord.js.map