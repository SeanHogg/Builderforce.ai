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
/** The order the design fixes: Synapse, then Evermind, then Ollama. */
export const EMBEDDER_ORDER = ['synapse', 'evermind', 'ollama'];
/** The first warm source's port, in {@link EMBEDDER_ORDER}; undefined when none is warm. */
export async function resolveWarmEmbedder(sources) {
    const ordered = [...sources].sort((a, b) => EMBEDDER_ORDER.indexOf(a.id) - EMBEDDER_ORDER.indexOf(b.id));
    for (const source of ordered) {
        let warm = false;
        try {
            warm = source.warm();
        }
        catch {
            warm = false;
        }
        if (!warm)
            continue;
        const port = await Promise.resolve(source.port()).catch(() => undefined);
        if (port && port.dims > 0 && port.fingerprint)
            return port;
    }
    return undefined;
}
/**
 * A single-text embedder (`embed(text)`, e.g. the SSM runtime or memory-mcp's
 * `TextEmbedderLike`) as an {@link EmbedderPort}. The fingerprint names the model and its
 * width, so an index coded under another model is re-embedded, never mixed.
 */
export function batchEmbedder(single, fingerprint, dims) {
    return {
        fingerprint: `${fingerprint}:${dims}`,
        dims,
        async embed(texts) {
            const out = [];
            for (const text of texts) {
                const v = await single.embed(text);
                if (!v || v.length !== dims)
                    throw new Error(`embedder ${fingerprint} returned ${v ? v.length : 'no'} dims, expected ${dims}`);
                out.push(v instanceof Float32Array ? v : Float32Array.from(v));
            }
            return out;
        },
    };
}
/**
 * A source over a model the host has on disk but does not hold: cold until it is loaded,
 * and loaded only on idle — `warm()` reading cold is what asks for the load, so a request
 * never waits on it. One load per stamp: a stamp that failed to load is not retried until
 * the model on disk changes.
 */
export function idleLoadedEmbedder(options) {
    let loaded;
    let attempted;
    const current = () => {
        let stamp;
        try {
            stamp = options.stamp();
        }
        catch {
            stamp = undefined;
        }
        if (!stamp) {
            loaded = undefined;
            return undefined;
        }
        if (loaded?.stamp === stamp)
            return loaded.port;
        loaded = undefined;
        if (attempted !== stamp) {
            attempted = stamp;
            options.idle(async () => {
                const port = await options.load(stamp).catch(() => undefined);
                if (port && port.dims > 0 && port.fingerprint)
                    loaded = { stamp, port };
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
//# sourceMappingURL=embedderChain.js.map