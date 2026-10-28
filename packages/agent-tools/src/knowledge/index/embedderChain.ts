/**
 * The host's embedder for the knowledge index (docs/design/deterministic-knowledge-index.md,
 * "Where it runs"): Synapse (`bfi-node`) first, then the Evermind CPU embed, then a
 * resident Ollama embedding model — the FIRST that is warm right now. None warm ⇒ no
 * embedder: the index serves exact + lexical and says so (`tiers`), and never mixes
 * vectors of two fingerprints.
 *
 * Nothing here loads a model on a request's path. A source is warm only while its host
 * already holds one; a model the host merely has ON DISK (an Evermind checkpoint) is
 * loaded on idle first ({@link idleLoadedEmbedder}) and reads cold until it is.
 */

import type { EmbedderPort } from '@seanhogg/builderforce-memory/knowledge';
import type { IdleScheduler, WarmEmbedderSource } from './contract.js';

/** The order the design fixes: Synapse, then Evermind, then Ollama. */
export const EMBEDDER_ORDER: ReadonlyArray<WarmEmbedderSource['id']> = ['synapse', 'evermind', 'ollama'];

/** The first warm source's port, in {@link EMBEDDER_ORDER}; undefined when none is warm. */
export async function resolveWarmEmbedder(sources: readonly WarmEmbedderSource[]): Promise<EmbedderPort | undefined> {
    const ordered = [...sources].sort((a, b) => EMBEDDER_ORDER.indexOf(a.id) - EMBEDDER_ORDER.indexOf(b.id));
    for (const source of ordered) {
        let warm = false;
        try { warm = source.warm(); } catch { warm = false; }
        if (!warm) continue;
        const port = await Promise.resolve(source.port()).catch(() => undefined);
        if (port && port.dims > 0 && port.fingerprint) return port;
    }
    return undefined;
}

/**
 * A single-text embedder (`embed(text)`, e.g. the SSM runtime or memory-mcp's
 * `TextEmbedderLike`) as an {@link EmbedderPort}. The fingerprint names the model and its
 * width, so an index coded under another model is re-embedded, never mixed.
 */
export function batchEmbedder(single: { embed(text: string): Promise<Float32Array | ArrayLike<number> | null | undefined> }, fingerprint: string, dims: number): EmbedderPort {
    return {
        fingerprint: `${fingerprint}:${dims}`,
        dims,
        async embed(texts) {
            const out: Float32Array[] = [];
            for (const text of texts) {
                const v = await single.embed(text);
                if (!v || v.length !== dims) throw new Error(`embedder ${fingerprint} returned ${v ? v.length : 'no'} dims, expected ${dims}`);
                out.push(v instanceof Float32Array ? v : Float32Array.from(v));
            }
            return out;
        },
    };
}

export interface IdleLoadedEmbedderOptions {
    id: WarmEmbedderSource['id'];
    /**
     * The model on disk NOW, as a stamp (its path and save time), or undefined when none
     * is present. Cheap — it never loads anything. A new stamp (an adapted checkpoint was
     * saved) drops the loaded port: its vectors are another fingerprint's.
     */
    stamp(): string | undefined;
    /** Load the model the stamp names — run only on idle. Undefined ⇒ it cannot embed. */
    load(stamp: string): Promise<EmbedderPort | undefined>;
    /** The scheduler the load waits for. Its OWN — a coalescing scheduler shared with the
     *  index would let the load replace the index's pending idle pass. */
    idle: IdleScheduler;
}

/**
 * A source over a model the host has on disk but does not hold: cold until it is loaded,
 * and loaded only on idle — `warm()` reading cold is what asks for the load, so a request
 * never waits on it. One load per stamp: a stamp that failed to load is not retried until
 * the model on disk changes.
 */
export function idleLoadedEmbedder(options: IdleLoadedEmbedderOptions): WarmEmbedderSource {
    let loaded: { stamp: string; port: EmbedderPort } | undefined;
    let attempted: string | undefined;
    const current = (): EmbedderPort | undefined => {
        let stamp: string | undefined;
        try { stamp = options.stamp(); } catch { stamp = undefined; }
        if (!stamp) {
            loaded = undefined;
            return undefined;
        }
        if (loaded?.stamp === stamp) return loaded.port;
        loaded = undefined;
        if (attempted !== stamp) {
            attempted = stamp;
            options.idle(async () => {
                const port = await options.load(stamp).catch(() => undefined);
                if (port && port.dims > 0 && port.fingerprint) loaded = { stamp, port };
            });
        }
        return undefined;
    };
    return {
        id: options.id,
        warm: () => current() !== undefined,
        port: () => current(),
    };
}
