/**
 * knowledge/pinpointMatch.ts - the ONE matching core of "pinpoint from a screenshot"
 * (PRD 38, Option B+, "Core use"), shared by every host (VS Code, web, Rovr). The AI reads the
 * picture (the host sends `pinpointVisionRequest`, then `parseVisionReply`); everything
 * after that is deterministic and lives here:
 *
 *   1. anchors  - the visible strings, cleaned and bounded;
 *   2. matches  - every literal's exact hits first (`exact`), then the i18n catalogs: a
 *                 catalog key leads to the files that use it (`catalog`);
 *   3. imports  - one hop over the graph's `references` edges (`import`).
 *
 * Hosts supply only the adapters: a literal `search`, an optional `catalogKeys` (a host with
 * the catalogs in hand), an optional `readText`, and the root's `graph`. Pure, Worker-safe.
 */

import { sourcePathOf } from './rootId.js';
import { srcRef, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

/** Visible strings used at most. */
export const MAX_PINPOINT_TEXTS = 12;
/** Matches returned at most. */
export const MAX_PINPOINT_MATCHES = 40;
/** Slots kept for the one-hop imports, so direct matches cannot crowd them out. */
const IMPORT_RESERVE = 8;
/** Files one literal's (or one key's) hits are followed in. */
const FILES_PER_TEXT = 8;
/** Catalog keys one literal is followed through. */
const KEYS_PER_TEXT = 3;
const MIN_TEXT_LENGTH = 3;
const MAX_TEXT_LENGTH = 200;
/** A bare (undotted) catalog leaf shorter than this ("title") is too common to search usages for. */
const MIN_LEAF_KEY_LENGTH = 10;
/** Searches run at once. */
const SEARCH_CONCURRENCY = 4;

/** The largest screenshot a host encodes and sends. */
export const MAX_PINPOINT_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Throws, naming why, unless a screenshot of this type and size may be sent. */
export function checkPinpointImage(image: { type: string; size: number }): void {
    if (!IMAGE_TYPES.has(image.type)) throw new Error('The screenshot must be a PNG, JPEG, WebP or GIF image.');
    if (image.size > MAX_PINPOINT_IMAGE_BYTES) throw new Error('The screenshot must be under 8 MB.');
}

const DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
/** The longest data URL of a screenshot within {@link MAX_PINPOINT_IMAGE_BYTES} (base64 is 4 chars per 3 bytes). */
const MAX_DATA_URL_CHARS = Math.ceil((MAX_PINPOINT_IMAGE_BYTES * 4) / 3) + 64;

/** For a host that receives the screenshot as a data URL: the length is checked BEFORE the pattern runs. */
export function checkPinpointDataUrl(image: unknown): asserts image is string {
    if (typeof image !== 'string' || image.length > MAX_DATA_URL_CHARS || !DATA_URL.test(image)) {
        throw new Error('The screenshot must be a PNG, JPEG, WebP or GIF image under 8 MB.');
    }
}

export type PinpointProvenance = 'exact' | 'catalog' | 'import';

export interface PinpointMatch { ref: string; why: string; provenance: PinpointProvenance }

export interface PinpointMatchResult {
    description: string;
    anchors: { text: string; provenance: 'vision' }[];
    matches: PinpointMatch[];
}

export interface PinpointHit {
    /** Root-relative, `/`-separated. */
    path: string;
    line: number;
    text: string;
    /**
     * False when the host could not confirm the literal is on the line (a server index hit,
     * not a text scan). Such a hit never becomes an `exact` match; it is accepted only when
     * looking up a catalog KEY's usages, and then only if `tier` is `exact`/`lexical` or the
     * key is found in the file's text (`readText`).
     */
    verified?: boolean;
    /** The server index tier of an unverified hit. */
    tier?: string;
}

export interface PinpointPorts {
    rootId: string;
    /** A LITERAL (not a regex) search over the root. */
    search(literal: string): Promise<PinpointHit[]>;
    /** Catalog keys whose value is `text`, for a host that has the catalogs in hand. */
    catalogKeys?(text: string): Promise<string[]>;
    /** A root-relative file's text (to find a JSON catalog's full dotted key). */
    readText?(relPath: string): Promise<string | undefined>;
    /** The root's graph: matches are kept to files it has, and imports follow its edges. */
    graph(): Promise<KnowledgeGraph | null>;
}

/** An OpenAI-style content part: the gateway moves a request carrying an image to a vision model. */
export type VisionContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** What the vision model is asked: JSON only, the description and the verbatim strings. */
export const PINPOINT_VISION_SYSTEM = [
    'You read a screenshot of a software product.',
    'Reply with JSON only: {"description": one line saying what the screen shows and, if it looks stuck or broken, how,',
    '"texts": the exact visible strings (labels, headings, buttons, status text, error messages), at most 12, verbatim}.',
].join(' ');

/** Tokens the vision reply needs: a one-line description and up to twelve strings. */
export const PINPOINT_VISION_MAX_TOKENS = 1024;

/** THE vision request body of every host: no pinned model, the gateway picks a vision-capable one. */
export function pinpointVisionRequest(imageDataUrl: string): {
    messages: Array<{ role: 'system' | 'user'; content: string | VisionContentPart[] }>;
    temperature: number;
    max_tokens: number;
} {
    return {
        messages: [
            { role: 'system', content: PINPOINT_VISION_SYSTEM },
            { role: 'user', content: [{ type: 'image_url', image_url: { url: imageDataUrl } }] },
        ],
        temperature: 0,
        max_tokens: PINPOINT_VISION_MAX_TOKENS,
    };
}

/** The `{description, texts}` a vision reply holds; tolerant of prose around the JSON. */
export function parseVisionReply(reply: string): { description: string; texts: string[] } {
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('The model did not return a reading of the screenshot.');
    const body = JSON.parse(reply.slice(start, end + 1)) as { description?: unknown; texts?: unknown };
    return {
        description: typeof body.description === 'string' ? body.description : '',
        texts: Array.isArray(body.texts) ? body.texts.filter((t): t is string => typeof t === 'string') : [],
    };
}

/** An i18n catalog or a package's labels file. */
export const isCatalogPath = (path: string): boolean =>
    /(^|\/)i18n\/messages\/[^/]+\.json$/.test(path) || /(^|\/)locales?\/[^/]+\.json$/.test(path) || /(^|\/)labels\.ts$/.test(path);

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Up to `limit` dotted keys whose string value is `text` in a nested catalog object. */
export function keysOfValue(node: unknown, text: string, limit = KEYS_PER_TEXT, prefix = ''): string[] {
    if (typeof node === 'string') return node === text && prefix ? [prefix] : [];
    if (node === null || typeof node !== 'object') return [];
    const found: string[] = [];
    for (const [key, value] of Object.entries(node)) {
        if (found.length >= limit) break;
        found.push(...keysOfValue(value, text, limit - found.length, prefix ? `${prefix}.${key}` : key));
    }
    return found;
}

/** The visible strings, trimmed, de-duplicated, length-bounded and capped at {@link MAX_PINPOINT_TEXTS}. */
export function cleanTexts(texts: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of texts) {
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
        if (out.length >= MAX_PINPOINT_TEXTS) break;
    }
    return out;
}

/** `fn` over `items`, `limit` at a time, results in item order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

/** The catalog keys behind `text` for a hit inside a catalog file (the matched line is the fallback). */
async function keysOfCatalogHit(ports: PinpointPorts, hit: PinpointHit, text: string): Promise<string[]> {
    if (hit.path.endsWith('.json') && ports.readText) {
        const raw = await ports.readText(hit.path);
        if (raw) {
            try {
                const keys = keysOfValue(JSON.parse(raw), text);
                if (keys.length > 0) return keys;
            } catch {
                // A catalog that does not parse falls back to the matched line's own key.
            }
        }
    }
    const leaf = /^\s*["']?([\w.-]+)["']?\s*:/.exec(hit.text)?.[1];
    return leaf && (leaf.includes('.') || leaf.length >= MIN_LEAF_KEY_LENGTH) ? [leaf] : [];
}

/** May this key-usage hit be trusted? A verified scan hit, a lexical/exact index hit, or a file whose text holds the key. */
async function trustedUsage(ports: PinpointPorts, hit: PinpointHit, key: string): Promise<boolean> {
    if (hit.verified !== false) return true;
    if (hit.tier === 'exact' || hit.tier === 'lexical') return true;
    return !!ports.readText && ((await ports.readText(hit.path))?.includes(key) ?? false);
}

export async function matchAnchors(ports: PinpointPorts, seen: { description: string; texts: readonly string[] }): Promise<PinpointMatchResult> {
    const texts = cleanTexts(seen.texts);
    const graph = await ports.graph();
    // A truncated graph does not list every file: filtering by it would drop real matches.
    const known = graph && !graph.stats.truncated ? new Set<string>(graph.nodes.map((n) => n.ref)) : undefined;
    const matches = new Map<string, PinpointMatch>();
    const direct = MAX_PINPOINT_MATCHES - IMPORT_RESERVE;

    const add = (path: string, why: string, provenance: PinpointProvenance, cap = direct): void => {
        const ref = srcRef(ports.rootId, path);
        if (matches.size >= cap || matches.has(ref) || (known && !known.has(ref))) return;
        matches.set(ref, { ref, why, provenance });
    };

    // Phase 1: every text's exact hits, so a text with a catalog key cannot crowd out the others.
    const found = await mapLimit(texts, SEARCH_CONCURRENCY, (text) => ports.search(text).catch(() => [] as PinpointHit[]));
    const pending: Array<{ key: string; text: string }> = [];
    for (const [i, text] of texts.entries()) {
        for (const key of (await ports.catalogKeys?.(text).catch(() => [] as string[]) ?? []).slice(0, KEYS_PER_TEXT)) pending.push({ key, text });
        const files = new Set<string>();
        for (const hit of found[i]!.filter((h) => h.verified !== false && h.text.includes(text))) {
            if (files.size >= FILES_PER_TEXT) break;
            if (files.has(hit.path)) continue;
            files.add(hit.path);
            if (!isCatalogPath(hit.path)) { add(hit.path, `"${text}" (line ${hit.line})`, 'exact'); continue; }
            for (const key of (await keysOfCatalogHit(ports, hit, text)).slice(0, KEYS_PER_TEXT)) {
                if (!pending.some((p) => p.key === key && p.text === text)) pending.push({ key, text });
            }
        }
    }

    // Phase 2: the files that use each catalog key.
    const usages = await mapLimit(pending, SEARCH_CONCURRENCY, async ({ key }) => ports.search(key).catch(() => [] as PinpointHit[]));
    for (const [i, { key, text }] of pending.entries()) {
        const files = new Set<string>();
        for (const usage of usages[i]!) {
            if (files.size >= FILES_PER_TEXT) break;
            if (isCatalogPath(usage.path) || files.has(usage.path) || !(await trustedUsage(ports, usage, key))) continue;
            files.add(usage.path);
            add(usage.path, `key ${key} for "${text}"`, 'catalog');
        }
    }

    // Phase 3: one hop - the files that import a matched file.
    if (graph) {
        const matched = new Set(matches.keys());
        for (const edge of graph.edges) {
            if (edge.kind !== 'references' || !matched.has(edge.to) || matched.has(edge.from)) continue;
            const to = sourcePathOf(edge.to, ports.rootId);
            const from = sourcePathOf(edge.from, ports.rootId);
            if (to === undefined || from === undefined) continue;
            add(from, `imports ${basename(to)}`, 'import', MAX_PINPOINT_MATCHES);
        }
    }

    return {
        description: seen.description,
        anchors: texts.map((text) => ({ text, provenance: 'vision' as const })),
        matches: [...matches.values()],
    };
}
