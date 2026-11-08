/// <reference types="node" />
/**
 * Exact postMessage accounting. A structured clone copies every byte of a message except transferred buffers, so the copied
 * size is deterministic: `v8.serialize` byte length (V8's structured-clone wire format) minus the byteLength of the buffers in
 * the transfer list. The ledger also counts graph ELEMENT objects found inside a message: a `run` or `done` must carry none
 * (the worker owns the graph; only ids and results cross), so a non-zero count there is a regression.
 *
 * API choice: metered messages hold proxies, which `v8.serialize` cannot write, so the constructor takes an `unwrap` function
 * (typically `(v) => unwrapDeep(v, [meter])`). `record` counts element refs on the ORIGINAL message, then serialises
 * `unwrap(message)`. Call `record` inside `meter.without(...)` so the walk itself costs no metered reads.
 */

import { serialize } from 'node:v8';

export interface WireEntry {
    /** in = main to worker, out = worker to main. */
    dir: 'in' | 'out';
    /** WorkerIn / WorkerOut type. */
    type: string;
    /** Task kind for run / done (done: the caller supplies it). */
    kind?: string;
    /** load-chunk field. */
    field?: string;
    /** load-chunk element count. */
    items?: number;
    /** Copied bytes: v8.serialize(value).byteLength minus the byteLength of transferred buffers. */
    bytes: number;
    transferredBytes: number;
    /** Graph element objects found inside (must be 0 for run / done). */
    elementRefs: number;
}

export interface WireGroup { messages: number; bytes: number; transferredBytes: number; maxBytes: number; elementRefs: number }
export interface WireSummary { groups: Record<string, WireGroup>; maxMessageBytes: number }

/** Placeholder that makes a fresh array literal PACKED_ELEMENTS (tagged) from birth; it is overwritten before the array is used. */
const TAGGED_SEED = Object.freeze({});

/**
 * The same value, in a form whose `v8.serialize` length depends on the VALUE alone, never on V8's internal representation of it.
 *
 * Without this the count drifts within one process: V8 serialises a number by how it is HELD, not what it is. A Smi `1` costs
 * 2 bytes; the same `1` read from an object field whose hidden class was generalised to a Double field (because SOME object of
 * that shape, earlier in the process, held a 1.5), or from a PACKED_DOUBLE array (allocation-site feedback), costs 9. Those
 * generalisations are process-wide and one-way, so the second profile in a process serialised the very same graph larger than
 * the first (`wire:in:load-chunk:edges:bytes` 3,767,257 then 3,774,442). The canonical form rebuilds every plain object as a
 * dictionary-mode (null-prototype) object and every array as a PACKED_ELEMENTS one, and stores each integer that fits int32 as
 * `x | 0` (a Smi): nothing it holds carries a representation from elsewhere. Shared sub-objects stay shared (V8 writes a
 * back-reference for a repeat, as it would for the original). Typed arrays and buffers pass through untouched: their bytes are
 * their contents, and the transfer list is matched by identity.
 */
export function canonicalForSize(value: unknown): unknown {
    const done = new Map<object, unknown>();
    const walk = (v: unknown): unknown => {
        if (typeof v === 'number') return Number.isInteger(v) && v === (v | 0) && !Object.is(v, -0) ? v | 0 : v;
        if (typeof v !== 'object' || v === null || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v;
        const seen = done.get(v);
        if (seen !== undefined) return seen;
        if (Array.isArray(v)) {
            if (v.length === 0) { const empty: unknown[] = []; done.set(v, empty); return empty; }
            const out: unknown[] = [TAGGED_SEED];
            done.set(v, out);
            out[0] = walk(v[0]);
            for (let i = 1; i < v.length; i++) out.push(walk(v[i]));
            return out;
        }
        if (v instanceof Map) {
            const out = new Map<unknown, unknown>();
            done.set(v, out);
            for (const [k, x] of v) out.set(walk(k), walk(x));
            return out;
        }
        if (v instanceof Set) {
            const out = new Set<unknown>();
            done.set(v, out);
            for (const x of v) out.add(walk(x));
            return out;
        }
        const proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null) return v; // a host / class object: serialised as V8 would anyway
        const out = Object.create(null) as Record<string, unknown>;
        done.set(v, out);
        for (const k of Object.keys(v)) out[k] = walk((v as Record<string, unknown>)[k]);
        return out;
    };
    return walk(value);
}

export function serializedBytes(value: unknown, transfer: readonly ArrayBuffer[] = []): { bytes: number; transferredBytes: number } {
    const transferredBytes = [...new Set(transfer)].reduce((n, b) => n + b.byteLength, 0);
    return { bytes: Math.max(0, serialize(canonicalForSize(value)).byteLength - transferredBytes), transferredBytes };
}

/** Number of values inside `value` for which `isElement` is true (objects, arrays, Map / Set values; typed arrays skipped). */
export function countElementRefs(value: unknown, isElement: (v: unknown) => boolean): number {
    const seen = new WeakSet<object>();
    const walk = (v: unknown): number => {
        if (typeof v !== 'object' || v === null || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return 0;
        if (isElement(v)) return 1;
        if (seen.has(v)) return 0;
        seen.add(v);
        let n = 0;
        if (Array.isArray(v)) for (let i = 0; i < v.length; i++) n += walk(v[i]);
        else if (v instanceof Map) for (const x of v.values()) n += walk(x);
        else if (v instanceof Set) for (const x of v) n += walk(x);
        else for (const k of Object.keys(v)) n += walk((v as Record<string, unknown>)[k]);
        return n;
    };
    return walk(value);
}

export class WireLedger {
    private log: WireEntry[] = [];

    constructor(private readonly isElement: (v: unknown) => boolean, private readonly unwrap: (v: unknown) => unknown = (v) => v) {}

    get entries(): readonly WireEntry[] { return this.log; }

    record(dir: 'in' | 'out', message: unknown, transfer: readonly ArrayBuffer[] = [], kind?: string): WireEntry {
        const m = (message ?? {}) as { type?: unknown; kind?: unknown; field?: unknown; items?: unknown };
        const items = m.items;
        const count = Array.isArray(items) ? items.length : ArrayBuffer.isView(items) ? (items as unknown as { length: number }).length : undefined;
        const entry: WireEntry = {
            dir, type: String(m.type ?? 'unknown'), bytes: 0, transferredBytes: 0,
            elementRefs: countElementRefs(message, this.isElement),
        };
        const k = kind ?? (typeof m.kind === 'string' ? m.kind : undefined);
        if (k !== undefined) entry.kind = k;
        if (typeof m.field === 'string') entry.field = m.field;
        if (count !== undefined) entry.items = count;
        Object.assign(entry, serializedBytes(this.unwrap(message), transfer));
        this.log.push(entry);
        return entry;
    }

    /** Deterministic totals per `${dir}:${type}[:kind|field]`, keys sorted, plus the largest single message. */
    summary(): WireSummary {
        const groups: Record<string, WireGroup> = {};
        let maxMessageBytes = 0;
        for (const e of this.log) {
            const suffix = e.kind ?? e.field;
            const key = `${e.dir}:${e.type}${suffix === undefined ? '' : ':' + suffix}`;
            const g = (groups[key] ??= { messages: 0, bytes: 0, transferredBytes: 0, maxBytes: 0, elementRefs: 0 });
            g.messages++; g.bytes += e.bytes; g.transferredBytes += e.transferredBytes; g.elementRefs += e.elementRefs;
            g.maxBytes = Math.max(g.maxBytes, e.bytes);
            maxMessageBytes = Math.max(maxMessageBytes, e.bytes);
        }
        const sorted: Record<string, WireGroup> = {};
        for (const k of Object.keys(groups).sort()) sorted[k] = groups[k]!;
        return { groups: sorted, maxMessageBytes };
    }

    reset(): void { this.log = []; }
}
