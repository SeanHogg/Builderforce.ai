/**
 * Inline art survives a patch.
 *
 * A guest's comic, animation or image keeps its pixels INLINE as `data:` URLs (nothing can
 * be uploaded). A Brain patch is sanitised to 40k-character strings, so a patch that echoes
 * such a field back arrives truncated, and a truncated data URL is destroyed art. This is the
 * one rule, applied where a patch meets the object it patches and true of every kind:
 *
 * A string whose CURRENT value is a `data:` URL is kept when the incoming string is damaged:
 *   - it starts with `data:` but is not a complete data URL (truncated or malformed), or
 *   - it is 40k+ characters and not a complete data URL.
 * Anything else replaces it: a complete data URL, an http(s) URL (a real hosted replacement),
 * any other deliberate string, and `''` (a deliberate clear).
 */

/** The sanitiser's string cap: a string at or past it was cut, whatever it looks like. */
const TRUNCATION_LENGTH = 40_000;

const DATA_URL = /^data:[^,]*,/;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

export function isCompleteDataUrl(value: string): boolean {
  if (value.length >= TRUNCATION_LENGTH) return false;
  const head = DATA_URL.exec(value);
  if (!head) return false;
  const body = value.slice(head[0].length);
  if (!/;base64,$/.test(head[0])) return true;
  return body.length % 4 === 0 && BASE64_BODY.test(body);
}

/** An incoming string that must not replace inline art: a cut or malformed data URL, or an oversized non-data-URL. */
function isDamaged(incoming: string): boolean {
  if (isCompleteDataUrl(incoming)) return false;
  return incoming.startsWith('data:') || incoming.length >= TRUNCATION_LENGTH;
}

const isRecord =(value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const idOf = (value: unknown): string | null => (isRecord(value) && typeof value.id === 'string' ? value.id : null);

function keep(current: unknown, incoming: unknown): unknown {
  if (typeof current === 'string' && current.startsWith('data:')) {
    return typeof incoming === 'string' && isDamaged(incoming) ? current : incoming;
  }
  if (Array.isArray(current) && Array.isArray(incoming)) {
    let changed = false;
    const next = incoming.map((item, index) => {
      const id = idOf(item);
      const twin = id === null ? current[index] : current.find((candidate) => idOf(candidate) === id);
      const merged = keep(twin, item);
      if (merged !== item) changed = true;
      return merged;
    });
    return changed ? next : incoming;
  }
  if (isRecord(current) && isRecord(incoming)) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(incoming)) {
      const merged = keep(current[key], value);
      if (merged !== value) changed = true;
      next[key] = merged;
    }
    return changed ? next : incoming;
  }
  return incoming;
}

/** `patch` with every field that would overwrite a `data:` URL in `current` with a non-data-URL string restored to the current value. */
export function preserveInlineDataUrls<Patch extends object>(current: Record<string, unknown> | null | undefined, patch: Patch): Patch {
  if (!current) return patch;
  return keep(current, patch) as Patch;
}
