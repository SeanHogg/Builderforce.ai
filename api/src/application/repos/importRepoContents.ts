/**
 * importRepoContents — read a connected repo's tree AND file contents in one
 * bounded fan-out, so the in-browser IDE can hydrate its editable workspace from
 * a real repository (the missing half of "connect to a repo": the existing
 * read tools fetch one file at a time for the agent; this bulk-reads for import).
 *
 * Server-side only (uses the decrypted git token, which never reaches the
 * browser). The caller (repoRoutes) returns the manifest; the frontend then
 * persists each file through its normal `saveFile` path, which already targets
 * the correct storage backend (worker R2 vs API R2) — so this module never has
 * to know which bucket the IDE reads from.
 *
 * Caps are deliberate (a giant monorepo must not blow the Worker's subrequest
 * budget, response size, or the model's later context): MAX_IMPORT_FILES files,
 * MAX_IMPORT_BYTES total, binary/asset extensions skipped. Anything dropped is
 * reported so the UI can say "imported N of M". Never throws.
 */
import { listRepoFiles, readRepoFile, type RepoReadContext } from './readRepoContents';

/** Hard cap on files pulled in one import (subrequest + response-size guard). */
const MAX_IMPORT_FILES = 200;
/** Hard cap on total imported bytes so the manifest stays a sane response size. */
const MAX_IMPORT_BYTES = 5_000_000;
/** Concurrency for the per-file reads (keeps the fan-out civil for rate limits). */
const READ_CONCURRENCY = 8;

/** Binary/asset files the text editor + WebContainer mount can't use as source. */
const SKIP_BINARY_EXT =
  /\.(png|jpe?g|gif|ico|webp|bmp|tiff?|woff2?|ttf|eot|otf|mp[34]|mov|avi|webm|wav|ogg|flac|pdf|zip|gz|tgz|tar|rar|7z|wasm|bin|exe|dll|so|dylib|class|jar|psd|ai|sketch|node)$/i;
/** Heavy, machine-generated files worth skipping on import (regen locally). */
const SKIP_NOISE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|out)\//i;

export interface ImportedFile {
  path: string;
  content: string;
  /** True when the file was clipped to the per-file size cap by readRepoFile. */
  truncated: boolean;
}

export interface ImportRepoResult {
  ok: boolean;
  ref: string;
  files: ImportedFile[];
  /** Total blob count discovered in the tree (before caps). */
  discovered: number;
  /** Paths skipped (binary/asset/noise) or dropped because a cap was hit. */
  skipped: string[];
  /** True when a cap (file count / total bytes / tree size) clipped the import. */
  truncated: boolean;
  /** Set when the tree listing itself failed. */
  error?: string;
}

/** Run `worker(item)` over `items` with bounded concurrency, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Read a repo's importable files into a manifest. Lists the tree, filters out
 * binary/asset/noise paths, then reads up to the caps. The tree listing already
 * caps at MAX_TREE_ENTRIES inside listRepoFiles; we surface `truncated` if either
 * that or our own caps clipped the result.
 */
export async function importRepoContents(ctx: RepoReadContext): Promise<ImportRepoResult> {
  const tree = await listRepoFiles(ctx);
  if (!tree.ok) {
    return { ok: false, ref: ctx.ref, files: [], discovered: 0, skipped: [], truncated: false, error: tree.reason };
  }

  const skipped: string[] = [];
  const importable: string[] = [];
  for (const path of tree.paths) {
    if (SKIP_BINARY_EXT.test(path) || SKIP_NOISE.test(path)) {
      skipped.push(path);
      continue;
    }
    importable.push(path);
  }

  // A cap was hit if the tree itself was truncated, or we have more importable
  // files than we'll read.
  let truncated = tree.truncated || importable.length > MAX_IMPORT_FILES;
  const toRead = importable.slice(0, MAX_IMPORT_FILES);
  for (const dropped of importable.slice(MAX_IMPORT_FILES)) skipped.push(dropped);

  const read = await mapLimit(toRead, READ_CONCURRENCY, (path) => readRepoFile(ctx, path));

  const files: ImportedFile[] = [];
  let bytes = 0;
  for (let i = 0; i < read.length; i++) {
    const rf = read[i]!;
    const path = toRead[i]!;
    if (!rf.ok) { skipped.push(path); continue; }
    if (bytes + rf.content.length > MAX_IMPORT_BYTES) {
      // Total-size cap reached: drop this and the rest, mark truncated.
      truncated = true;
      for (let j = i; j < read.length; j++) skipped.push(toRead[j]!);
      break;
    }
    bytes += rf.content.length;
    files.push({ path, content: rf.content, truncated: rf.truncated });
  }

  return { ok: true, ref: ctx.ref, files, discovered: tree.paths.length, skipped, truncated };
}
