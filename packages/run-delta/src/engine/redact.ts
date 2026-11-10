/**
 * engine/redact.ts — THE redaction of any string a delta carries (snippet, anchor, note, param,
 * signature), over `@builderforce/secret-redaction` `redactText` (never a copy of its patterns).
 * Short strings are memoized by VALUE (bounded), so the cache is call-independent and never keyed by
 * text identity.
 */

import { redactText } from '@builderforce/secret-redaction';

const CACHE_LIMIT = 4096;
const MEMO_MAX_LENGTH = 512;
const cache = new Map<string, string>();

export function redact(s: string): string {
    if (s.length === 0) return s;
    if (s.length > MEMO_MAX_LENGTH) return redactText(s);
    const hit = cache.get(s);
    if (hit !== undefined) return hit;
    if (cache.size >= CACHE_LIMIT) cache.clear();
    const out = redactText(s);
    cache.set(s, out);
    return out;
}
