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
import { isInSkippedDir, isOutputDirName } from '@builderforce/agent-tools/skip-dirs';
import { listRepoFiles, readRepoFile, type RepoReadContext } from './readRepoContents';

/** Hard cap on files pulled in one import (subrequest + response-size guard). */
const MAX_IMPORT_FILES = 200;
/** Hard cap on total imported bytes so the manifest stays a sane response size. */
const MAX_IMPORT_BYTES = 5_000_000;
/** Concurrency for the per-file reads (keeps the fan-out civil for rate limits). */
const READ_CONCURRENCY = 8;

/** Binary/asset files the text editor + in-browser runtime mount can't use as source. */
const SKIP_BINARY_EXT =
  /\.(png|jpe?g|gif|ico|webp|bmp|tiff?|woff2?|ttf|eot|otf|mp[34]|mov|avi|webm|wav|ogg|flac|pdf|zip|gz|tgz|tar|rar|7z|wasm|bin|exe|dll|so|dylib|class|jar|psd|ai|sketch|node)$/i;

export interface ImportedFile {
  path: string;
  content: string;
  /** Always false: a file read only in part is never imported — it is `skipped` with its reason. */
  truncated: boolean;
}

/**
 * Why a path was left out of the manifest: an asset or generated path, past an import
 * cap, unreadable, or read only in part — past the per-file read cap (`too-large`) or
 * cut short by the provider (`incomplete`). A part-read file is never imported: saved,
 * its fragment would be pushed back over the real file.
 */
export type ImportSkipReason = 'binary' | 'noise' | 'cap' | 'unreadable' | 'too-large' | 'incomplete';

export interface SkippedFile {
  path: string;
  reason: ImportSkipReason;
}

export interface ImportRepoResult {
  ok: boolean;
  ref: string;
  files: ImportedFile[];
  /** Total blob count discovered in the tree (before caps). */
  discovered: number;
  /** Paths left out, each with why. */
  skipped: SkippedFile[];
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

  const skipped: SkippedFile[] = [];
  const importable: string[] = [];
  for (const path of tree.paths) {
    if (SKIP_BINARY_EXT.test(path)) skipped.push({ path, reason: 'binary' });
    // Heavy, machine-generated files worth skipping on import (regen locally): the ONE build-output / dependency list.
    else if (isInSkippedDir(path, isOutputDirName)) skipped.push({ path, reason: 'noise' });
    else importable.push(path);
  }

  // A cap was hit if the tree itself was truncated, or we have more importable
  // files than we'll read.
  let truncated = tree.truncated || importable.length > MAX_IMPORT_FILES;
  const toRead = importable.slice(0, MAX_IMPORT_FILES);
  for (const dropped of importable.slice(MAX_IMPORT_FILES)) skipped.push({ path: dropped, reason: 'cap' });

  const read = await mapLimit(toRead, READ_CONCURRENCY, (path) => readRepoFile(ctx, path));

  const files: ImportedFile[] = [];
  let bytes = 0;
  for (let i = 0; i < read.length; i++) {
    const rf = read[i]!;
    const path = toRead[i]!;
    if (!rf.ok) { skipped.push({ path, reason: 'unreadable' }); continue; }
    if (rf.truncated) {
      skipped.push({ path, reason: rf.truncatedReason === 'incomplete' ? 'incomplete' : 'too-large' });
      continue;
    }
    if (bytes + rf.content.length > MAX_IMPORT_BYTES) {
      // Total-size cap reached: drop this and the rest, mark truncated.
      truncated = true;
      for (let j = i; j < read.length; j++) skipped.push({ path: toRead[j]!, reason: 'cap' });
      break;
    }
    bytes += rf.content.length;
    files.push({ path, content: rf.content, truncated: false });
  }

  return { ok: true, ref: ctx.ref, files, discovered: tree.paths.length, skipped, truncated };
}
