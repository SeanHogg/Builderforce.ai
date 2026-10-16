/**
 * Read a cloned repo's working tree into memory, as the in-browser runtime takes
 * files (`path → text | bytes`), so the build gate can type-check and build what
 * the agent is about to push.
 *
 * Its own narrow fs port rather than a widening of `FsLike`: the git client only
 * ever writes, and keeping reads here leaves its fakes untouched. LightningFS
 * satisfies it as-is.
 */

export interface TreeFs {
  promises: {
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<{ isDirectory(): boolean; size: number }>;
    readFile(path: string): Promise<Uint8Array | string>;
  };
}

/** Never part of what a project builds from. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);

/** Past these the repo is not something to build in a browser tab; the gate declines. */
export const TREE_LIMITS = { maxFiles: 5_000, maxBytes: 64 * 1024 * 1024, maxFileBytes: 8 * 1024 * 1024 };

export type WorkingTree =
  | { kind: 'files'; files: Record<string, string | Uint8Array> }
  | { kind: 'too-large'; reason: string };

const decoder = new TextDecoder('utf-8', { fatal: true });

/** Text when the bytes are valid UTF-8 with no NUL, otherwise the bytes themselves (images, fonts). */
function asContent(raw: Uint8Array | string): string | Uint8Array {
  if (typeof raw === 'string') return raw;
  if (raw.includes(0)) return raw;
  try {
    return decoder.decode(raw);
  } catch {
    return raw;
  }
}

export async function readWorkingTree(fs: TreeFs, dir: string, limits = TREE_LIMITS): Promise<WorkingTree> {
  const files: Record<string, string | Uint8Array> = {};
  let count = 0;
  let bytes = 0;
  const pending = [''];
  while (pending.length) {
    const relative = pending.pop()!;
    for (const name of await fs.promises.readdir(relative ? `${dir}/${relative}` : dir)) {
      const path = relative ? `${relative}/${name}` : name;
      const stat = await fs.promises.stat(`${dir}/${path}`);
      if (stat.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(name)) pending.push(path);
        continue;
      }
      if (stat.size > limits.maxFileBytes) continue;
      count += 1;
      bytes += stat.size;
      if (count > limits.maxFiles || bytes > limits.maxBytes) {
        return { kind: 'too-large', reason: `the repository is larger than ${limits.maxFiles} files / ${limits.maxBytes / (1024 * 1024)} MB` };
      }
      files[path] = asContent(await fs.promises.readFile(`${dir}/${path}`));
    }
  }
  return { kind: 'files', files };
}
