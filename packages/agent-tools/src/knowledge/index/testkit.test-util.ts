/**
 * Fixtures for the host knowledge-index tests: in-memory files, a manual idle scheduler,
 * a deterministic embedder and a small symbol-indexed workspace.
 */

import type { EmbedderPort } from '@seanhogg/builderforce-memory/knowledge';
import type { IdleScheduler, KnowledgeIndexFiles } from './contract.js';
import type { SymbolFile } from './seedCode.js';

export interface MemoryFiles extends KnowledgeIndexFiles {
    store: Map<string, Uint8Array>;
    reads: string[];
    writes: string[];
    renames: Array<[string, string]>;
}

export function memoryFiles(): MemoryFiles {
    const f: MemoryFiles = {
        store: new Map(), reads: [], writes: [], renames: [],
        async read(path) { f.reads.push(path); return f.store.get(path); },
        async write(path, bytes) { f.writes.push(path); f.store.set(path, bytes.slice()); },
        async rename(from, to) {
            f.renames.push([from, to]);
            const b = f.store.get(from);
            if (!b) throw new Error(`no ${from}`);
            f.store.set(to, b);
            f.store.delete(from);
        },
        async mkdir() {},
        async remove(path) { f.store.delete(path); },
    };
    return f;
}

export interface ManualIdle extends IdleScheduler {
    pending(): boolean;
    run(): Promise<void>;
}

export function manualIdle(): ManualIdle {
    let task: (() => Promise<void>) | undefined;
    const idle = ((t: () => Promise<void>) => { task = t; }) as ManualIdle;
    idle.pending = () => !!task;
    idle.run = async () => {
        const t = task;
        task = undefined;
        await t?.();
    };
    return idle;
}

/** Character-bucket vectors, L2-normalised: deterministic, and similar text is close. */
export function bucketEmbedder(fingerprint = 'bucket-v1', dims = 16): EmbedderPort & { calls: number } {
    const port = {
        fingerprint, dims, calls: 0,
        async embed(texts: string[]) {
            port.calls += texts.length;
            return texts.map((t) => {
                const v = new Float32Array(dims);
                for (const ch of t.toLowerCase()) {
                    const i = ch.charCodeAt(0) % dims;
                    v[i] = (v[i] ?? 0) + 1;
                }
                const n = Math.hypot(...v) || 1;
                return v.map((x) => x / n);
            });
        },
    };
    return port;
}

const fn = (name: string, line = 1) => ({ name, kind: 'function' as const, line, exported: true });

export const WORKSPACE_FILES: SymbolFile[] = [
    { path: 'src/billing/invoice.ts', symbols: [fn('createInvoice'), fn('voidInvoice', 20)] },
    { path: 'src/billing/stripeWebhook.ts', symbols: [fn('handleStripeWebhook')] },
    { path: 'src/auth/session.ts', symbols: [fn('resolveMembership')] },
    { path: 'src/net/retryPolicy.ts', symbols: [fn('retryPolicy'), fn('backoffDelay', 9)] },
    { path: 'README.md', symbols: [] },
];
