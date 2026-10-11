/**
 * The live sub-agents of every chat — who spawned whom, which are still working, and what
 * each reported.
 *
 * A child is an ordinary run (see `brainRunHost.ts`); this registry holds only what makes
 * it someone's CHILD: its handle (`a1`, `a2`, … per chat, what the owner and the person
 * address it by), its owner's run key, and its report once it settles. Pure — no editor,
 * no store — so the ownership rules are tested on their own.
 *
 * Delivery is exactly-once: a report goes to a `wait_agents` call that is waiting for it,
 * or, when nobody waits, to the owner's inbox (`deliver`). Never both.
 */

import type { RunLineage } from "@seanhogg/builderforce-brain-embedded";

/** Live children a chat may hold at once — a runaway spawner stops here, not at the provider. */
export const MAX_LIVE_CHILDREN = 12;

/** How deep spawning nests: a grandchild's child is the last one that may spawn. */
export const MAX_CHILD_DEPTH = 3;

export type ChildState = "running" | "done" | "failed" | "stopped";

/** What a settled child tells its owner. */
export interface ChildReport {
  handle: string;
  name: string;
  label: string;
  state: Exclude<ChildState, "running">;
  output: string;
  ticket?: string;
  changedFiles?: string[];
}

/** One child as the panel shows it. */
export interface ChildView {
  key: number;
  handle: string;
  name: string;
  label: string;
  owner: string;
  ownerKey: number;
  depth: number;
  readOnly: boolean;
  ticket?: string;
}

interface ChildRecord {
  key: number;
  lineage: RunLineage;
  readOnly: boolean;
  ticket?: string;
  state: ChildState;
  report?: ChildReport;
  /** Its owner (or the person) stopped it — it settles as `stopped`, not `failed`. */
  stopRequested?: boolean;
}

interface Waiter {
  ownerKey: number;
  /** Handles waited for; empty = every child of the owner live when the wait began. */
  handles: Set<string>;
  reports: ChildReport[];
  done(): void;
}

export interface ChildRuns {
  /** A key and handle for a new child of `ownerKey`, or why it may not start. */
  register(input: Omit<RunLineage, "handle"> & { readOnly: boolean; ticket?: string }): { key: number; lineage: RunLineage } | { error: string };
  /** The child settled. Returns the report when NO waiter took it — the caller delivers it. */
  settle(key: number, report: ChildReport): ChildReport | null;
  /** A child of `ownerKey` addressed by handle (only an owner commands its own children). */
  find(ownerKey: number, handle: string): { key: number; state: ChildState; lineage: RunLineage } | null;
  /** Mark a child as stopped on purpose, before its run is aborted. */
  requestStop(key: number): void;
  /** Whether {@link requestStop} was called for this child. */
  stopRequested(key: number): boolean;
  /** The record behind a run key, when that run is a child. */
  lineageOf(key: number): RunLineage | null;
  /** Live children of one owner. */
  liveOf(ownerKey: number): Array<{ key: number; handle: string }>;
  /** Live children anywhere in a chat, for the panel. */
  viewsIn(rootChatId: number): ChildView[];
  /** Resolve when the named (or all live) children of `ownerKey` settle, or at the timeout. */
  wait(ownerKey: number, handles: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<{ reports: ChildReport[]; running: string[] }>;
}

export function createChildRuns(): ChildRuns {
  const records = new Map<number, ChildRecord>();
  const counters = new Map<number, number>();
  const waiters = new Set<Waiter>();
  // Below every real chat id and every unlinked native run id, and unique for the session.
  let nextKey = -2_000_000_000;

  const live = (pred: (r: ChildRecord) => boolean) => [...records.values()].filter((r) => r.state === "running" && pred(r));

  return {
    register(input) {
      if (input.depth > MAX_CHILD_DEPTH) return { error: `sub-agents nest at most ${MAX_CHILD_DEPTH} deep — do this slice yourself` };
      if (live((r) => r.lineage.rootChatId === input.rootChatId).length >= MAX_LIVE_CHILDREN) {
        return { error: `${MAX_LIVE_CHILDREN} sub-agents are already working in this chat — wait for one to finish (wait_agents) before starting another` };
      }
      const n = (counters.get(input.rootChatId) ?? 0) + 1;
      counters.set(input.rootChatId, n);
      const { readOnly, ticket, ...rest } = input;
      const lineage: RunLineage = { ...rest, handle: `a${n}` };
      const key = nextKey--;
      records.set(key, { key, lineage, readOnly, ...(ticket ? { ticket } : {}), state: "running" });
      return { key, lineage };
    },

    settle(key, report) {
      const rec = records.get(key);
      if (!rec || rec.state !== "running") return null;
      rec.state = report.state;
      rec.report = report;
      for (const w of waiters) {
        if (w.ownerKey !== rec.lineage.ownerKey || !w.handles.has(rec.lineage.handle)) continue;
        w.reports.push(report);
        w.handles.delete(rec.lineage.handle);
        if (w.handles.size === 0) w.done();
        return null;
      }
      return report;
    },

    find(ownerKey, handle) {
      for (const r of records.values()) {
        if (r.lineage.ownerKey === ownerKey && r.lineage.handle === handle) return { key: r.key, state: r.state, lineage: r.lineage };
      }
      return null;
    },

    requestStop(key) {
      const rec = records.get(key);
      if (rec) rec.stopRequested = true;
    },

    stopRequested: (key) => records.get(key)?.stopRequested === true,

    lineageOf: (key) => records.get(key)?.lineage ?? null,

    liveOf: (ownerKey) => live((r) => r.lineage.ownerKey === ownerKey).map((r) => ({ key: r.key, handle: r.lineage.handle })),

    viewsIn: (rootChatId) =>
      live((r) => r.lineage.rootChatId === rootChatId).map((r) => ({
        key: r.key,
        handle: r.lineage.handle,
        name: r.lineage.agent.name,
        label: r.lineage.label,
        owner: r.lineage.ownerName,
        ownerKey: r.lineage.ownerKey,
        depth: r.lineage.depth,
        readOnly: r.readOnly,
        ...(r.ticket ? { ticket: r.ticket } : {}),
      })),

    wait(ownerKey, handles, timeoutMs, signal) {
      const mine = [...records.values()].filter((r) => r.lineage.ownerKey === ownerKey);
      const named = handles.length ? mine.filter((r) => handles.includes(r.lineage.handle)) : mine.filter((r) => r.state === "running");
      // A child named after it already settled answers at once with what it reported.
      const settled = named.flatMap((r) => (r.state !== "running" && r.report ? [r.report] : []));
      const pending = new Set(named.filter((r) => r.state === "running").map((r) => r.lineage.handle));
      return new Promise((resolve) => {
        const waiter: Waiter = { ownerKey, handles: pending, reports: [...settled], done: () => finish() };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (!waiters.delete(waiter)) return;
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", finish);
          resolve({ reports: waiter.reports, running: [...waiter.handles] });
        };
        waiters.add(waiter);
        if (pending.size === 0) return finish();
        timer = setTimeout(finish, timeoutMs);
        signal?.addEventListener("abort", finish, { once: true });
      });
    },
  };
}
