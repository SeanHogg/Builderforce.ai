/// <reference types="node" />
/**
 * A digest of a value that is the same on every run and independent of insertion order: it proves a worker result equals the
 * in-process one and that two runs agree. Object keys are sorted, Map entries and Set values are ordered by their own digest,
 * typed arrays hash their type name and exact bytes, numbers keep `Object.is` identity (-0 and NaN stay distinguishable), and
 * a key holding `undefined` differs from a missing key. SHA-1 from `node:crypto` (collision resistance is not the point; a
 * stable short fingerprint is), truncated to 16 hex characters.
 */

import { createHash, type Hash } from 'node:crypto';

const MAX_DEPTH = 64;

function feed(h: Hash, v: unknown, stack: object[]): void {
    const tag = (s: string): void => { h.update(s); h.update(';'); };
    switch (typeof v) {
        case 'undefined': return tag('u');
        case 'boolean': return tag(v ? 't' : 'f');
        case 'number': return tag('n' + (Object.is(v, -0) ? '-0' : String(v)));
        case 'bigint': return tag('b' + v.toString());
        case 'string': return tag('s' + v.length + ':' + v);
        case 'symbol': return tag('y' + String(v.description));
        case 'function': return tag('F');
    }
    if (v === null) return tag('z');
    const obj = v as object;
    if (stack.includes(obj) || stack.length > MAX_DEPTH) return tag('cycle');
    stack.push(obj);
    if (ArrayBuffer.isView(obj)) {
        tag('T' + obj.constructor.name + ':' + obj.byteLength);
        h.update(new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength));
    } else if (obj instanceof ArrayBuffer) {
        tag('B' + obj.byteLength);
        h.update(new Uint8Array(obj));
    } else if (Array.isArray(obj)) {
        tag('A' + obj.length);
        for (let i = 0; i < obj.length; i++) feed(h, obj[i], stack);
    } else if (obj instanceof Map) {
        tag('M' + obj.size);
        const entries = [...obj].map(([k, x]) => [sub(k, stack), sub(x, stack)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
        for (const [k, x] of entries) { tag(k); tag(x); }
    } else if (obj instanceof Set) {
        tag('S' + obj.size);
        for (const x of [...obj].map((y) => sub(y, stack)).sort()) tag(x);
    } else if (obj instanceof Date) {
        tag('D' + obj.getTime());
    } else {
        const keys = Object.keys(obj).sort();
        tag('O' + keys.length);
        for (const k of keys) { tag('k' + k.length + ':' + k); feed(h, (obj as Record<string, unknown>)[k], stack); }
    }
    stack.pop();
}

/** A child's own digest, used to order unordered collections. */
function sub(v: unknown, stack: object[]): string {
    const h = createHash('sha1');
    feed(h, v, stack);
    return h.digest('hex');
}

export function canonicalHash(value: unknown): string {
    return sub(value, []).slice(0, 16);
}
