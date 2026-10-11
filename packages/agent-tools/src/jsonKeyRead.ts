/**
 * Read ONE subtree of a JSON file by its dot path — the `key` argument of `read_file`.
 *
 * Observed (VS Code chat #133): a run that had to move the `admin.visitorFlow` and
 * `admin.sessions` blocks of a 33,278-line i18n catalog read `en.json` sixteen times,
 * paging line windows in search of two keys it could name exactly. A line window is
 * the wrong unit for a catalog: the agent knows WHICH key it wants, not which line it
 * sits on. This returns that key's value, pretty-printed — or, when the value is too
 * big to return whole, its child keys so the next read can name one of them.
 *
 * Pure: no I/O, no surface knowledge. The tool reads the file; this reads the JSON.
 */

/** Largest subtree returned whole; above it, the child keys are returned instead. */
export const JSON_KEY_READ_MAX_CHARS = 12_000;
/** How many sibling or child keys a miss or an oversized value lists. */
const MAX_LISTED_KEYS = 60;

export type JsonKeyRead =
  | { ok: true; key: string; content: string }
  | { ok: true; key: string; tooLarge: true; size: number; childKeys: string[] }
  | { ok: false; error: string; availableKeys?: string[] };

function keysOf(value: unknown): string[] {
  return value !== null && typeof value === "object" ? Object.keys(value as Record<string, unknown>) : [];
}

/**
 * The value at `key` (`"admin.visitorFlow"`; a numeric segment indexes an array) in
 * the JSON `text`. A segment that is missing reports the keys that DO exist at that
 * level, so the retry is a correction rather than another guess.
 */
export function readJsonKey(text: string, key: string): JsonKeyRead {
  let root: unknown;
  try {
    root = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "the file is not valid JSON, so `key` cannot be used — read it by line window instead" };
  }
  const segments = key.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) return { ok: false, error: "`key` is empty — name a dot path such as \"admin.visitorFlow\"" };

  let node: unknown = root;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const container = node !== null && typeof node === "object" ? (node as Record<string, unknown>) : null;
    if (!container || !Object.prototype.hasOwnProperty.call(container, segment)) {
      const at = segments.slice(0, i).join(".") || "(root)";
      return {
        ok: false,
        error: `key "${segments.slice(0, i + 1).join(".")}" not found — ${at} has no "${segment}"`,
        availableKeys: keysOf(node).slice(0, MAX_LISTED_KEYS),
      };
    }
    node = container[segment];
  }

  const content = JSON.stringify(node, null, 2) ?? "null";
  if (content.length <= JSON_KEY_READ_MAX_CHARS) return { ok: true, key: segments.join("."), content };
  return { ok: true, key: segments.join("."), tooLarge: true, size: content.length, childKeys: keysOf(node).slice(0, MAX_LISTED_KEYS) };
}
