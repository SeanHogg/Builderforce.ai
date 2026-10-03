/**
 * Project-wide text search over an IDE workspace: the "Search" half of the file
 * panel (find every place a name or string appears, then jump to it).
 *
 * Reads the workspace through `workspaceStore`, the single contract for keys and
 * paths. Not cached, on purpose: the answer changes with every save, and a cache
 * keyed on content would cost a version read per file anyway. Instead each search
 * is bounded: binary and oversized files are skipped, reads run in small batches,
 * and the result stops at a match cap and says it was cut.
 */
import { listWorkspaceFiles, readWorkspaceFile } from './workspaceStore';

export interface WorkspaceSearchMatch {
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** The matching line, trimmed to a window around the match. */
  preview: string;
}

export interface WorkspaceSearchResult {
  matches: WorkspaceSearchMatch[];
  /** True when a cap stopped the search before it looked everywhere. */
  truncated: boolean;
}

export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 200;
const MAX_MATCHES = 200;
const MAX_FILES = 400;
const MAX_FILE_BYTES = 512 * 1024;
const READ_BATCH = 8;
const PREVIEW_RADIUS = 60;

/** Files whose bytes are not text a person searches: images, fonts, archives, media. */
const BINARY_EXTENSION = /\.(png|jpe?g|gif|webp|avif|ico|bmp|svgz|woff2?|ttf|otf|eot|zip|gz|tgz|br|pdf|mp[34]|wav|ogg|webm|mov|wasm|onnx|bin|lock)$/i;

/** Every case-insensitive occurrence of `query` in `text`, with a readable preview. */
export function findMatches(path: string, text: string, query: string, limit = MAX_MATCHES): WorkspaceSearchMatch[] {
  const needle = query.toLowerCase();
  const out: WorkspaceSearchMatch[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length && out.length < limit; index += 1) {
    const line = lines[index]!;
    const haystack = line.toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0 || out.length >= limit) break;
      const start = Math.max(0, at - PREVIEW_RADIUS);
      const end = Math.min(line.length, at + needle.length + PREVIEW_RADIUS);
      const preview = `${start > 0 ? '…' : ''}${line.slice(start, end).trim()}${end < line.length ? '…' : ''}`;
      out.push({ path, line: index + 1, column: at + 1, preview });
      from = at + needle.length;
    }
  }
  return out;
}

export async function searchWorkspace(bucket: R2Bucket, projectId: number, query: string): Promise<WorkspaceSearchResult> {
  const files = (await listWorkspaceFiles(bucket, projectId))
    .filter((file) => file.size > 0 && file.size <= MAX_FILE_BYTES && !BINARY_EXTENSION.test(file.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  const searchable = files.slice(0, MAX_FILES);
  let truncated = files.length > searchable.length;
  const matches: WorkspaceSearchMatch[] = [];

  for (let i = 0; i < searchable.length && matches.length < MAX_MATCHES; i += READ_BATCH) {
    const batch = searchable.slice(i, i + READ_BATCH);
    const texts = await Promise.all(batch.map((file) => readWorkspaceFile(bucket, projectId, file.path)));
    batch.forEach((file, index) => {
      const text = texts[index];
      if (text == null || matches.length >= MAX_MATCHES) return;
      matches.push(...findMatches(file.path, text, query, MAX_MATCHES - matches.length));
    });
  }
  if (matches.length >= MAX_MATCHES) truncated = true;
  return { matches, truncated };
}
