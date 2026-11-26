/**
 * The Knowledge view's persisted rolling log: one small text file under the extension's global storage, so a
 * reload (or a crash) does not lose the lines that explain a first load. Newest lines are returned by `tail`
 * and ride the bridge's `loadTrace` answer into "Copy diagnostics". Size-capped: past `maxBytes` the file is
 * moved to `<file>.1` (replacing the previous one), so at most two files of that size exist.
 *
 * Plain `node:fs`, no `vscode`. Appends are serialised; a failed append is reported to `onError` (never thrown,
 * never appended back to the file).
 */

import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

export const ROLLING_LOG_MAX_BYTES = 256 * 1024;

export interface RollingLog {
  append(line: string): void;
  /** The newest `n` lines, oldest first. */
  tail(n: number): Promise<string[]>;
}

export interface RollingLogOptions {
  maxBytes?: number;
  now?: () => string;
  onError?: (error: unknown) => void;
}

export function createRollingLog(file: string, opts: RollingLogOptions = {}): RollingLog {
  const maxBytes = opts.maxBytes ?? ROLLING_LOG_MAX_BYTES;
  const now = opts.now ?? ((): string => new Date().toISOString());
  let chain: Promise<void> = Promise.resolve();
  const read = (path: string): Promise<string> => readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") opts.onError?.(error);
    return "";
  });
  return {
    append(line) {
      const text = `${now()} ${line.replace(/\r?\n/g, " ⏎ ")}\n`;
      chain = chain.then(async () => {
        await mkdir(dirname(file), { recursive: true });
        const size = await stat(file).then((s) => s.size, (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") opts.onError?.(error);
          return 0;
        });
        // Bytes, not UTF-16 units; an empty or absent file is never rotated (a rename of nothing would fail the append).
        if (size > 0 && size + Buffer.byteLength(text) > maxBytes) await rename(file, `${file}.1`);
        await appendFile(file, text, "utf8");
      }).catch((error: unknown) => opts.onError?.(error));
    },
    async tail(n) {
      await chain;
      const text = `${await read(`${file}.1`)}${await read(file)}`;
      return text.split("\n").filter((l) => l.length > 0).slice(-n);
    },
  };
}
