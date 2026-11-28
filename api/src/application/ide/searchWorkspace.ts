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
import { findLiteralMatches, scanFiles } from '@builderforce/agent-tools/text-scan';
import { PANEL_SEARCH_MAX_FILES, SNAPSHOT_FILE_MAX_BYTES } from '@builderforce/tool-output-policy';
import { R2_READ_CONCURRENCY, r2WorkspaceFs } from './r2WorkspaceFs';

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
const PREVIEW_RADIUS = 60;

/** Files whose bytes are not text a person searches: images, fonts, archives, media. */
const BINARY_EXTENSION = /\.(png|jpe?g|gif|webp|avif|ico|bmp|svgz|woff2?|ttf|otf|eot|zip|gz|tgz|br|pdf|mp[34]|wav|ogg|webm|mov|wasm|onnx|bin|lock)$/i;

/** Every case-insensitive occurrence of `query` in `text`, with a readable preview. */
export function findMatches(path: string, text: string, query: string, limit = MAX_MATCHES): WorkspaceSearchMatch[] {
  return findLiteralMatches(text, query, { limit }).map(({ line: lineNumber, column, lineText }) => {
    const at = column - 1;
    const start = Math.max(0, at - PREVIEW_RADIUS);
    const end = Math.min(lineText.length, at + query.length + PREVIEW_RADIUS);
    const preview = `${start > 0 ? '…' : ''}${lineText.slice(start, end).trim()}${end < lineText.length ? '…' : ''}`;
    return { path, line: lineNumber, column, preview };
  });
}

/**
 * The shared line scanner over the workspace, with the panel's own caps. Its matcher stays here
 * (the panel is a literal, case-insensitive find that reports a column and every occurrence on a
 * line), and no directory is skipped: the panel searches what the workspace holds.
 */
export async function searchWorkspace(bucket: R2Bucket, projectId: number, query: string): Promise<WorkspaceSearchResult> {
  // One page of keys (the panel's bound): a workspace past it is reported truncated rather than paged whole per keystroke.
  const fs = r2WorkspaceFs(bucket, projectId, { maxPages: 1 });
  const found = await scanFiles(fs, query, '', {
    concurrency: R2_READ_CONCURRENCY,
    maxMatches: MAX_MATCHES,
    maxFiles: PANEL_SEARCH_MAX_FILES,
    maxFileBytes: SNAPSHOT_FILE_MAX_BYTES,
    dirFilter: () => true,
    skipFile: (path, size) => (size !== undefined && (size === 0 || size > SNAPSHOT_FILE_MAX_BYTES)) || BINARY_EXTENSION.test(path),
    lineMatcher: (path, text, line) => findMatches(path, text, query).map((m) => ({ ...m, line, text: m.preview })),
  });
  const hits = (found.matches ?? []) as unknown as WorkspaceSearchMatch[];
  const matches = hits.slice(0, MAX_MATCHES).map(({ path, line, column, preview }) => ({ path, line, column, preview }));
  return { matches, truncated: found.truncated === true || hits.length > MAX_MATCHES || !found.ok || fs.listingIncomplete() };
}
