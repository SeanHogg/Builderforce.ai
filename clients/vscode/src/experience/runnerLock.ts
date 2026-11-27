import * as fs from "fs";

/**
 * A machine-wide "one run at a time" lock. Two editor windows share one experience store
 * and one desktop, so two runs at once would fight over the mouse. The lock is a file
 * beside `experience.json` holding `{pid, sessionId}`, created exclusively; it is stale
 * (and taken over) when its pid is no longer alive.
 *
 * Because exactly one run can hold it, it also answers "is a `running` run in the store
 * really orphaned?": it is, unless ANOTHER live process holds the lock right now.
 */

export interface LockFs {
  /** Creates the file with `content`; false when it already exists. */
  createExclusive(file: string, content: string): boolean;
  read(file: string): string | undefined;
  remove(file: string): void;
}

export const nodeLockFs: LockFs = {
  createExclusive(file, content) {
    try {
      fs.writeFileSync(file, content, { flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },
  read(file) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  remove(file) {
    fs.rmSync(file, { force: true });
  },
};

/** Whether a process with this pid exists (`kill(pid, 0)`; EPERM still means it exists). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface RunnerLock {
  /** Take the lock (or confirm it is ours). False when another live process holds it. */
  acquire(): Promise<boolean>;
  /** Give it up, if it is ours. */
  release(): Promise<void>;
  /** Another live process holds it. */
  heldByOther(): Promise<boolean>;
}

export interface RunnerLockOptions {
  /** The lock file's path (resolved lazily: the store's folder is known only once it is open). */
  file(): Promise<string>;
  pid: number;
  /** Unique per extension-host session, so a recycled pid is never mistaken for us. */
  sessionId: string;
  isAlive?(pid: number): boolean;
  fs?: LockFs;
}

interface Owner {
  pid: number;
  sessionId: string;
}

function parse(raw: string | undefined): Owner | undefined {
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw) as Partial<Owner>;
    return typeof o.pid === "number" && typeof o.sessionId === "string" ? { pid: o.pid, sessionId: o.sessionId } : undefined;
  } catch {
    return undefined;
  }
}

export function createRunnerLock(opts: RunnerLockOptions): RunnerLock {
  const lockFs = opts.fs ?? nodeLockFs;
  const alive = opts.isAlive ?? pidAlive;
  const mine = JSON.stringify({ pid: opts.pid, sessionId: opts.sessionId });

  return {
    async acquire() {
      const file = await opts.file();
      for (let attempt = 0; attempt < 2; attempt++) {
        if (lockFs.createExclusive(file, mine)) return true;
        const raw = lockFs.read(file);
        const owner = parse(raw);
        if (owner?.sessionId === opts.sessionId) return true;
        if (owner && alive(owner.pid)) return false;
        // Stale (dead owner, or unreadable): take it over, unless someone else just did.
        if (lockFs.read(file) === raw) lockFs.remove(file);
      }
      return false;
    },

    async release() {
      const file = await opts.file();
      if (parse(lockFs.read(file))?.sessionId === opts.sessionId) lockFs.remove(file);
    },

    async heldByOther() {
      const owner = parse(lockFs.read(await opts.file()));
      return !!owner && owner.sessionId !== opts.sessionId && alive(owner.pid);
    },
  };
}
