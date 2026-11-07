/**
 * The replica pump's lock (PRD 41 A7): two windows on one folder share ONE queue file, and only the
 * window holding `.builderforce/knowledge/<root>.replica.lock` pumps it. The lock holds `{ pid, at }`,
 * is refreshed every 30 s while held, and is stale after 2 minutes (a crashed window never blocks the
 * other). Pure over {@link KnowledgeFiles}; a read-after-write check settles two windows racing.
 */

import { replicaFileName, type KnowledgeFiles } from "@builderforce/agent-tools/knowledge";

export const LOCK_REFRESH_MS = 30_000;
export const LOCK_STALE_MS = 120_000;

export const lockFileName = (rootId: string): string => replicaFileName(rootId).replace(/\.json$/, ".lock");

interface LockRecord { pid: number; at: number }

function parse(text: string | undefined): LockRecord | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as Partial<LockRecord>;
    return typeof v.pid === "number" && typeof v.at === "number" ? { pid: v.pid, at: v.at } : undefined;
  } catch {
    return undefined;
  }
}

export interface ReplicaLock { release(): Promise<void> }

/** The lock for `rootId`, or undefined when another live window holds it. */
export async function acquireReplicaLock(
  files: KnowledgeFiles,
  rootId: string,
  opts: { pid?: number; now?: () => number } = {},
): Promise<ReplicaLock | undefined> {
  const pid = opts.pid ?? process.pid;
  const now = opts.now ?? Date.now;
  const name = lockFileName(rootId);
  const held = parse(await files.read(name).catch(() => undefined));
  if (held && held.pid !== pid && held.at > 0 && now() - held.at < LOCK_STALE_MS) return undefined;
  const stamp = async (at: number): Promise<void> => { await files.write(name, JSON.stringify({ pid, at })); };
  const mine = now();
  await stamp(mine);
  const check = parse(await files.read(name).catch(() => undefined));
  if (!check || check.pid !== pid) return undefined;
  const timer = setInterval(() => { void stamp(now()).catch(() => undefined); }, LOCK_REFRESH_MS);
  (timer as { unref?: () => void }).unref?.();
  return {
    async release() {
      clearInterval(timer);
      await stamp(0).catch(() => undefined);
    },
  };
}
