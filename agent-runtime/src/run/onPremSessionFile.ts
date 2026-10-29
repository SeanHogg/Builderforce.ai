/**
 * The on-prem run's STORE port: the run's state lives in a session file, plain JSON, so
 * a run that yields (a cron tick at `maxSteps: 1`) or parks on a person resumes from it —
 * by this process or the next one.
 *
 * It saves and loads; it decides nothing. A run that ENDED (finished or failed) has
 * nothing to resume, so the adapter clears the file then; a file that is left is a run
 * that is still open.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunState, RunStore } from "@builderforce/agent-run";
import { logWarn } from "../logger.js";

export interface SessionFileStore extends RunStore {
  /** Remove the file: the run it held has ended. */
  clear(): Promise<void>;
}

/**
 * A store over `file`. Without a file the state is kept in memory for the invocation
 * (a run nothing will resume). `commitMemory` is the host's write-back of the run's
 * consolidated memory.
 */
export function sessionFileStore(
  file: string | undefined,
  commitMemory?: (consolidated: unknown) => Promise<void> | void,
): SessionFileStore {
  let held: RunState | undefined;
  return {
    async load() {
      if (held) return held;
      if (!file) return undefined;
      try {
        held = JSON.parse(await readFile(file, "utf8")) as RunState;
        return held;
      } catch (err) {
        // No file is a fresh run. A file that cannot be read is said, then the run starts fresh.
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          logWarn(`[on-prem] session file ${file} unreadable, starting fresh: ${String(err)}`);
        }
        return undefined;
      }
    },
    async save(state) {
      held = state;
      if (!file) return;
      try {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(state), "utf8");
      } catch (err) {
        logWarn(`[on-prem] session file ${file} not saved: ${String(err)}`);
      }
    },
    async clear() {
      held = undefined;
      if (!file) return;
      try {
        await rm(file, { force: true });
      } catch (err) {
        logWarn(`[on-prem] session file ${file} not removed: ${String(err)}`);
      }
    },
    ...(commitMemory ? { commitMemory } : {}),
  };
}
