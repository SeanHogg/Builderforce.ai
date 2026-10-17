/**
 * Files in, a ZIP archive out — the ONE zip writer in the frontend.
 *
 * Over `fflate`'s `zipSync`, the same codec the in-browser runtime's `exportZip` uses.
 * There used to be a hand-written STORE writer (CRC table, local and central headers)
 * in `courseLms.ts` and three more copies in tests; a zip is a format with a library,
 * not something to re-derive per feature.
 *
 * `level` 0 writes STORED members (no compression) — what a SCORM package and the
 * office-format tests want; the default compresses, for a project download.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';

export type ZipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export function zipFiles(
  files: Readonly<Record<string, string | Uint8Array>>,
  options: { level?: ZipLevel } = {},
): Uint8Array<ArrayBuffer> {
  const entries: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = typeof content === 'string' ? strToU8(content) : content;
  }
  // `zipSync` allocates its output itself, so it always sits on a plain ArrayBuffer —
  // the narrowing `Blob` and `Response` bodies need.
  return zipSync(entries, { level: options.level ?? 6 }) as Uint8Array<ArrayBuffer>;
}
