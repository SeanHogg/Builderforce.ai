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

export function serializedBytes(value: unknown, transfer: readonly ArrayBuffer[] = []): { bytes: number; transferredBytes: number } {
    const transferredBytes = [...new Set(transfer)].reduce((n, b) => n + b.byteLength, 0);
    return { bytes: Math.max(0, serialize(value).byteLength - transferredBytes), transferredBytes };
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
