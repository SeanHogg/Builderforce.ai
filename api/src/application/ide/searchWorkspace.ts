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
import { scanFiles } from '@builderforce/agent-tools/text-scan';
import { r2WorkspaceFs } from './r2WorkspaceFs';

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

/**
 * The shared line scanner over the workspace, with the panel's own caps. Its matcher stays here
 * (the panel is a literal, case-insensitive find that reports a column and every occurrence on a
 * line), and no directory is skipped: the panel searches what the workspace holds.
 */
export async function searchWorkspace(bucket: R2Bucket, projectId: number, query: string): Promise<WorkspaceSearchResult> {
  const found = await scanFiles(r2WorkspaceFs(bucket, projectId), query, '', {
    maxMatches: MAX_MATCHES,
    maxFiles: MAX_FILES,
    maxFileBytes: MAX_FILE_BYTES,
    dirFilter: () => true,
    skipFile: (path, size) => (size !== undefined && (size === 0 || size > MAX_FILE_BYTES)) || BINARY_EXTENSION.test(path),
    lineMatcher: (path, text, line) => findMatches(path, text, query).map((m) => ({ ...m, line, text: m.preview })),
  });
  const hits = (found.matches ?? []) as unknown as WorkspaceSearchMatch[];
  const matches = hits.slice(0, MAX_MATCHES).map(({ path, line, column, preview }) => ({ path, line, column, preview }));
  return { matches, truncated: found.truncated === true || hits.length > MAX_MATCHES || !found.ok };
}
