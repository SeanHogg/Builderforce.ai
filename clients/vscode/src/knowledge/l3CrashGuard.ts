/**
 * The L3 crash-loop breaker: a pass that took the WHOLE extension host down with it is never started again on its own for
 * the same tree — git repository or not, across any number of restarts.
 *
 * A host that dies mid-pass records nothing in-process (its catch never runs), so the proof has to be on disk BEFORE the pass
 * starts: an in-flight sentinel per root ({@link l3InFlightKey} = `{ sha, startedAt }`, workspaceState through the
 * `hostMemento` seam), written and awaited before the analysis starts, cleared when it ends — completed or failed. A sentinel
 * still there at a session's first look means the previous host died mid-pass, and L3 is quarantined for that root
 * ({@link l3QuarantineKey}, persisted):
 *
 *   - a git root: at that sha, until the root's commit moves;
 *   - a root git cannot name (no repository): for {@link L3_QUARANTINE_MS}.
 *
 * A pass that fails in a way a retry on the same tree cannot cure ({@link isPermanentL3Failure}: the worker's heap limit, a
 * result over the transfer budget) quarantines the same way. A quarantined start is refused with {@link L3Quarantined}, and
 * the output channel gets ONE line per root per session saying why and naming {@link L3_RETRY_COMMAND}, which lifts it.
 * A sub-folder root is held off by its folder's quarantine too ({@link l3BlockedFor}). A clean deactivation clears every
 * sentinel ({@link clearL3InFlight}), so a reload or a close mid-pass is never taken for a crash.
 *
 * ONE guard per root id per session ({@link l3CrashGuard}); applied where every L3 analysis enters the worker
 * (`l3SharedAnalysis.ts`), and read by the indexer's L3 gate before it starts a pass (`l3Persist.ts` `blocked`).
 */

import { isOverBudget } from "../workers/boundedTransfer";
import { hostMemento } from "./knowledgeSyncStatus";

/** The command that lifts a root's quarantine and asks for L3 again (`l3RetryCommand.ts`). */
export const L3_RETRY_COMMAND = "builderforce.knowledge.retryAnalyzers";

/** How long a root git cannot name stays quarantined after its pass took the host down (or failed permanently). */
export const L3_QUARANTINE_MS = 24 * 3_600_000;

/** The workspaceState key of a root's pass in flight. */
export const l3InFlightKey = (rootId: string): string => `builderforce.knowledge.l3InFlight.${rootId}`;
/** The workspaceState key of a root's L3 quarantine. */
export const l3QuarantineKey = (rootId: string): string => `builderforce.knowledge.l3Quarantine.${rootId}`;

/** The workspaceState key of the root ids that hold a quarantine record: what the retry command offers. */
export const L3_QUARANTINED_KEY = "builderforce.knowledge.l3Quarantined";

/** A pass in flight, as persisted. `sha` null ⇒ git could not name the tree. `where`: the root's folder, for people. */
export interface L3InFlight { sha: string | null; startedAt: number; where?: string }

/** Why and for which tree L3 is held off a root. `until` is set only for a tree git cannot name. `where`: the root's folder. */
export interface L3QuarantineRecord {
  sha: string | null;
  at: number;
  until?: number;
  reason: "host-died" | "permanent-failure";
  detail?: string;
  where?: string;
}

/** A quarantined root, as the retry command offers it. */
export interface L3QuarantinedRoot { rootId: string; where?: string; reason: string }

/** What the guard reads and writes of the workspace state. */
export interface L3GuardMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface L3GuardSeams {
  memento?: () => L3GuardMemento | undefined;
  now?: () => number;
  log?: (line: string) => void;
}

/** Whether an L3 pass failed in a way a retry on the same tree cannot cure: the worker hit its heap limit, or its result passed the transfer budget. */
export function isPermanentL3Failure(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e?.code === "ERR_WORKER_OUT_OF_MEMORY" || /memory limit|out of memory/i.test(String(e?.message ?? "")) || isOverBudget(error);
}

/** A start refused: L3 is quarantined for this root. Permanent for the tree, never retried by its asker. */
export class L3Quarantined extends Error {
  readonly code = "l3_quarantined";
  constructor(message: string) {
    super(message);
    this.name = "L3Quarantined";
  }
}

const describe = (q: L3QuarantineRecord): string => {
  const why = q.reason === "host-died"
    ? `the extension host stopped during the last L3 pass (started ${new Date(q.at).toISOString()})`
    : `the last L3 pass failed permanently (${q.detail ?? "unknown"})`;
  const until = q.until !== undefined ? `until ${new Date(q.until).toISOString()}` : `until the commit moves from ${q.sha!.slice(0, 12)}`;
  return `${why}, so the L3 analyzers are skipped ${until}`;
};

/**
 * A quarantine record as the guard reads it. A record of a tree git could not name (`sha: null`) written before `until`
 * existed gets the window from its recorded time; one with no usable time cannot be dated: undefined (dropped).
 */
export function normalisedQuarantine(q: L3QuarantineRecord | undefined): L3QuarantineRecord | undefined {
  if (!q || typeof q !== "object") return undefined;
  if (typeof q.sha === "string" || typeof q.until === "number") return q;
  return typeof q.at === "number" && Number.isFinite(q.at) ? { ...q, sha: null, until: q.at + L3_QUARANTINE_MS } : undefined;
}

/** One root's guard. Use {@link l3CrashGuard}: the leftover sentinel must be read once per session, before any pass of it. */
export class L3CrashGuard {
  private adopted: Promise<void> | undefined;
  private running = 0;
  private told = false;
  /** The root's folder, for people (the log line, the retry command's list); the root id when no caller named it. */
  private where: string | undefined;

  constructor(private readonly rootId: string, private readonly seams: Required<L3GuardSeams>) {}

  /**
   * Why L3 must not start on this root at `sha` now (null ⇒ git cannot name the tree), or undefined. Logs ONE line per session,
   * naming the root (`where`, its folder) and the retry command that lifts it.
   */
  async blocked(sha: string | null, where?: string): Promise<string | undefined> {
    this.where = where ?? this.where;
    await this.adopt();
    const q = normalisedQuarantine(this.read<L3QuarantineRecord>(l3QuarantineKey(this.rootId)));
    if (!q) {
      if (this.read(l3QuarantineKey(this.rootId)) !== undefined) await this.forget(); // undatable: dropped
      return undefined;
    }
    const now = this.seams.now();
    // A named tree is held until its commit moves; an unnamed one (either side) for the quarantine window.
    const held = q.sha !== null && sha !== null ? q.sha === sha : now < (q.until ?? q.at + L3_QUARANTINE_MS);
    if (!held) {
      await this.forget();
      return undefined;
    }
    const reason = describe(q);
    // A record written before the index existed (2026.10.172) is listed now, so the retry command can offer it.
    await this.list();
    if (!this.told) {
      this.told = true;
      const name = this.where ?? q.where ?? this.rootId;
      this.seams.log(`[knowledge] L3 analyzers skipped for ${name}${name === this.rootId ? "" : ` (${this.rootId})`}: ${reason}. To analyse it again now, run "BuilderForce: Retry Code Analyzers" (${L3_RETRY_COMMAND}) and choose ${name}.`);
    }
    return reason;
  }

  /** Before a pass starts: refuses a quarantined one ({@link L3Quarantined}), else persists the sentinel (awaited). */
  async begin(sha: string | null, where?: string): Promise<void> {
    const reason = await this.blocked(sha, where);
    if (reason) throw new L3Quarantined(`l3_quarantined: ${reason}`);
    this.running += 1;
    if (this.running === 1) {
      await this.write(l3InFlightKey(this.rootId), { sha, startedAt: this.seams.now(), ...(this.where ? { where: this.where } : {}) } satisfies L3InFlight);
    }
  }

  /** The pass ended — completed, stopped or failed: the sentinel goes once no pass of the root runs. A permanent failure quarantines. */
  async end(sha: string | null, error?: unknown): Promise<void> {
    this.running = Math.max(0, this.running - 1);
    if (error !== undefined && isPermanentL3Failure(error)) {
      await this.quarantine({ sha, at: this.seams.now(), reason: "permanent-failure", detail: error instanceof Error ? error.message : String(error) });
    }
    if (this.running === 0) await this.write(l3InFlightKey(this.rootId), undefined);
  }

  /** The person asked to retry (`builderforce.knowledge.retryAnalyzers`): the quarantine is lifted, whatever put it there. */
  async lift(): Promise<void> {
    await this.adopt();
    await this.forget();
  }

  /** The host is shutting down cleanly: a pass still in flight did not take it down, so its sentinel goes (awaited). */
  async shutdown(): Promise<void> {
    if (this.running === 0) return;
    this.running = 0;
    await this.write(l3InFlightKey(this.rootId), undefined);
  }

  /** A sentinel this session did not write: the previous host died mid-pass. Read once, before any pass of this session. */
  private adopt(): Promise<void> {
    return (this.adopted ??= (async () => {
      const left = this.read<L3InFlight>(l3InFlightKey(this.rootId));
      if (!left || typeof left !== "object") return;
      await this.quarantine({ sha: left.sha ?? null, at: left.startedAt, reason: "host-died", ...(left.where ? { where: left.where } : {}) });
      await this.write(l3InFlightKey(this.rootId), undefined);
    })());
  }

  private async quarantine(q: L3QuarantineRecord): Promise<void> {
    const where = q.where ?? this.where;
    const record: L3QuarantineRecord = { ...q, ...(q.sha === null ? { until: this.seams.now() + L3_QUARANTINE_MS } : {}), ...(where ? { where } : {}) };
    this.told = false; // a new quarantine is told afresh
    await this.write(l3QuarantineKey(this.rootId), record);
    await this.list();
  }

  /** The root is in the index of quarantined roots (what the retry command offers). */
  private async list(): Promise<void> {
    const listed = this.read<string[]>(L3_QUARANTINED_KEY) ?? [];
    if (!listed.includes(this.rootId)) await this.write(L3_QUARANTINED_KEY, [...listed, this.rootId].sort());
  }

  /** The quarantine is over (lifted, or the commit moved / the window passed): its record and its listing go. */
  private async forget(): Promise<void> {
    this.told = false;
    await this.write(l3QuarantineKey(this.rootId), undefined);
    const listed = this.read<string[]>(L3_QUARANTINED_KEY) ?? [];
    if (listed.includes(this.rootId)) await this.write(L3_QUARANTINED_KEY, listed.filter((id) => id !== this.rootId));
  }

  private read<T>(key: string): T | undefined {
    return this.seams.memento()?.get<T>(key);
  }

  private async write(key: string, value: unknown): Promise<void> {
    await Promise.resolve(this.seams.memento()?.update(key, value)).catch(() => undefined);
  }
}

const guards = new Map<string, L3CrashGuard>();
let outputLine: (line: string) => void = () => undefined;

/** Where the guard's one line per root goes (activation hands in the output channel); unset ⇒ silent. */
export function useL3GuardLog(log: (line: string) => void): void {
  outputLine = log;
}

/** THE guard of a root for this session, over the workspace state (`hostMemento`). `seams` ⇒ a fresh guard (tests). */
export function l3CrashGuard(rootId: string, seams?: L3GuardSeams): L3CrashGuard {
  const made = (): L3CrashGuard => new L3CrashGuard(rootId, {
    memento: seams?.memento ?? hostMemento, now: seams?.now ?? Date.now, log: seams?.log ?? ((line) => outputLine(line)),
  });
  if (seams) return made();
  let guard = guards.get(rootId);
  if (!guard) guards.set(rootId, (guard = made()));
  return guard;
}

/** The guard ids that hold a root off: its own, and for a sub-folder root (`<folder root id>:<rel>`) its folder's too. */
export function l3GuardIds(rootId: string, rel?: string): string[] {
  return rel && rootId.endsWith(`:${rel}`) ? [rootId, rootId.slice(0, -(rel.length + 1))] : [rootId];
}

/**
 * Why L3 must not start on `rootId` (a sub-folder root: or on its folder) at `sha`, or undefined. `where` is the root's folder
 * (for a sub-folder root, its folder's is `where` without the trailing `/<rel>`).
 */
export async function l3BlockedFor(rootId: string, rel: string | undefined, sha: string | null, seams?: L3GuardSeams, where?: string): Promise<string | undefined> {
  for (const id of l3GuardIds(rootId, rel)) {
    const slashed = where?.replace(/\\/g, "/");
    const place = id === rootId || !slashed || !rel || !slashed.endsWith(`/${rel}`) ? where : slashed.slice(0, -(rel.length + 1));
    const reason = await l3CrashGuard(id, seams).blocked(sha, place);
    if (reason) return reason;
  }
  return undefined;
}

/**
 * The roots that hold a quarantine record now (folder and sub-folder ones), for the retry command. An entry whose record is
 * gone or whose window has passed is pruned from the index; one `resolves` cannot place among the open folders (a folder
 * closed since) is left out but kept, so a lone stale entry is never picked silently. A git root whose commit moved is
 * still listed until the guard next looks at it (lifting it is harmless). Old records are normalised on load
 * ({@link normalisedQuarantine}): an undated non-git one gets its window and is persisted so; an undatable one is dropped.
 */
export async function quarantinedL3Roots(resolves: (rootId: string) => boolean = () => true, seams?: L3GuardSeams): Promise<L3QuarantinedRoot[]> {
  const memento = (seams?.memento ?? hostMemento)();
  const now = (seams?.now ?? Date.now)();
  const write = (key: string, value: unknown): Promise<void> => Promise.resolve(memento?.update(key, value)).catch(() => undefined);
  const listed = memento?.get<string[]>(L3_QUARANTINED_KEY) ?? [];
  const records = new Map<string, L3QuarantineRecord>();
  for (const rootId of listed) {
    const raw = memento?.get<L3QuarantineRecord>(l3QuarantineKey(rootId));
    const q = normalisedQuarantine(raw);
    if (q !== raw) await write(l3QuarantineKey(rootId), q);
    if (q && !(q.until !== undefined && now >= q.until)) records.set(rootId, q);
  }
  const live = listed.filter((rootId) => records.has(rootId));
  if (live.length !== listed.length) await write(L3_QUARANTINED_KEY, live);
  return live.filter(resolves).map((rootId) => {
    const q = records.get(rootId)!;
    return { rootId, ...(q.where ? { where: q.where } : {}), reason: describe(q) };
  });
}

/**
 * The extension host is deactivating (`beforeKnowledgeShutdown`): a window reload, VS Code closing, an update. Every pass still
 * in flight is ending with the process, not taking it down, so every sentinel is cleared — awaited, before the stores close —
 * and the next session does not mistake a clean shutdown for a crash.
 */
export async function clearL3InFlight(): Promise<void> {
  await Promise.all([...guards.values()].map((guard) => guard.shutdown()));
}

/** Forget every root's guard (tests: a new "session"). */
export function forgetL3Guards(): void {
  guards.clear();
}
