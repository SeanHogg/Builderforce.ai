/**
 * THE ONE catalog → typed-labels walker. A label object's English defaults name every key; a
 * host's catalog (next-intl's `t.raw` on the web, `use-intl`'s in the VS Code webview, the five
 * web catalogs in Rovr) mirrors that object key for key under ONE namespace. The walker reads
 * each leaf raw — `{placeholders}` stay for the view to fill from the data's own params — and a
 * key the catalog lacks keeps the English default rather than rendering its path.
 *
 * `knowledgeGraph.*` (`@builderforce/knowledge-browser` `knowledgeGraphLabels`) and `runDelta.*`
 * (`delta/labels.ts` `runDeltaLabels`) both go through here.
 */

type Tree = { [key: string]: string | Tree };

/**
 * A catalog value, or undefined when the host handed back a FALLBACK instead: use-intl's
 * `namespace.key`, or a bare `key` / last segment (a `getMessageFallback` returning the key,
 * as the VS Code webview's does) — those keep the English default, never render a key.
 */
function translated(got: unknown, namespace: string, key: string, name: string): string | undefined {
    if (typeof got !== 'string' || got.length === 0) return undefined;
    if (got === `${namespace}.${key}` || got === key || got === name) return undefined;
    return got;
}

/** `raw(key)` reads one catalog leaf under `<namespace>.` (undefined when absent). */
export function labelsFromCatalog<T extends object>(defaults: T, namespace: string, raw: (key: string) => unknown): T {
    const walk = (node: Tree, prefix: string): Tree => {
        const out: Tree = {};
        for (const [name, fallback] of Object.entries(node)) {
            const key = prefix ? `${prefix}.${name}` : name;
            out[name] = typeof fallback === 'string' ? translated(raw(key), namespace, key, name) ?? fallback : walk(fallback, key);
        }
        return out;
    };
    return walk(defaults as unknown as Tree, '') as unknown as T;
}
