/**
 * The `local_research` answer cache — keyed by WHAT was asked and WHICH bytes it was
 * answered from, never by time.
 *
 * A cached answer is valid exactly as long as the files it read are unchanged, so the key
 * is the question plus each file's path, mtime and size: edit one file and the key moves,
 * the old entry is never hit again, and the LRU bound ages it out. No TTL — an answer to
 * an untouched file is as true next week as it is now.
 *
 * Pure: {@link ResearchLru} is the in-memory structure and its JSON form; the surface
 * persists that form (`.builderforce/research-cache.json` on the editor).
 */

import type { ResearchFileFingerprint } from "./research-capability.js";

/** Entries kept before the least recently used is dropped. */
export const RESEARCH_CACHE_MAX_ENTRIES = 200;

/** FNV-1a 32-bit as 8 hex chars — a short map key; the full material is compared on read. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The cache key material: the question (whitespace-collapsed — the same words asked
 * twice), then every file sorted by path with its mtime and size.
 */
export function researchCacheKey(question: string, files: readonly ResearchFileFingerprint[]): string {
  const q = question.replace(/\s+/g, " ").trim();
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return JSON.stringify([q, ...sorted.map((f) => `${f.path}@${Math.round(f.mtimeMs)}:${f.size}`)]);
}

/** The persisted form: least recently used first. */
export interface ResearchLruJson {
  v: 1;
  entries: Array<[material: string, answer: string]>;
}

export class ResearchLru {
  private readonly entries = new Map<string, { material: string; answer: string }>();

  constructor(private readonly maxEntries: number = RESEARCH_CACHE_MAX_ENTRIES) {}

  get size(): number {
    return this.entries.size;
  }

  get(material: string): string | undefined {
    const id = fnv1a(material);
    const hit = this.entries.get(id);
    if (!hit || hit.material !== material) return undefined;
    // Touch: re-insert so Map order stays least-recently-used first.
    this.entries.delete(id);
    this.entries.set(id, hit);
    return hit.answer;
  }

  set(material: string, answer: string): void {
    const id = fnv1a(material);
    this.entries.delete(id);
    this.entries.set(id, { material, answer });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  toJSON(): ResearchLruJson {
    return { v: 1, entries: [...this.entries.values()].map((e) => [e.material, e.answer]) };
  }

  /** Rebuild from the persisted form; anything malformed is dropped, never thrown. */
  static fromJSON(raw: unknown, maxEntries: number = RESEARCH_CACHE_MAX_ENTRIES): ResearchLru {
    const lru = new ResearchLru(maxEntries);
    const json = raw as Partial<ResearchLruJson> | null;
    if (json?.v !== 1 || !Array.isArray(json.entries)) return lru;
    for (const entry of json.entries) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string") lru.set(entry[0], entry[1]);
    }
    return lru;
  }
}
