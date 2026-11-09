/**
 * The ledger of every sub-agent a chat started this session — what each was briefed with,
 * what it has run, how it ended — so its owner never pays twice for one child's work and
 * never loses a child without being told.
 *
 *   - {@link ChildLedger.liveWork}: the owner's live children with their briefs and the
 *     commands they have started, which the duplicate-command rule reads
 *     (`duplicateOfLiveChild`, `@builderforce/agent-tools`; chat #60338).
 *   - `persist`: after every spawn and settle the chat's children are handed to a port that
 *     writes each onto the journal record of the run that started it (`childRunJournal.ts`),
 *     so a run the editor dies inside comes back knowing its children (chat #61651). The
 *     writes of a chat are SERIAL (a later state never lands under an earlier one) and each
 *     is retried before it is given up and logged — a settle is never fire-and-forget;
 *     {@link ChildLedger.flush} awaits them.
 *
 * The registry (`childRuns.ts`) owns handles, delivery and waits; this holds only what the
 * registry does not: the brief and the report as the owner will need them after a restart.
 * Pure — no editor, no store; the ports are injected.
 */

import type { LiveChildWork, StartedCommand } from "@builderforce/agent-tools";
import type { ChildReport, ChildState } from "./childRuns";

/** Longest brief the journal keeps per child — enough to re-spawn or do the slice by hand. */
export const PERSISTED_BRIEF_CHARS = 4_000;

/** One child as it is persisted with its parent run. */
export interface PersistedChild {
  handle: string;
  label: string;
  /** The owner's name — a nested child's owner is another child. */
  owner: string;
  brief: string;
  role: string;
  ticket?: string;
  state: ChildState;
  /** How its report reached the owner: a `wait_agents` result, or the owner's inbox. */
  deliveredBy?: "wait" | "inbox";
  report?: ChildReport;
}

/** A child as the spawner registers it. */
export interface LedgerSpawn {
  key: number;
  ownerKey: number;
  rootChatId: number;
  handle: string;
  label: string;
  owner: string;
  brief: string;
  role: string;
  ticket?: string;
}

export interface ChildLedgerPorts {
  /** The `run_command` commands a child run has started so far (from its trace). */
  startedCommands?(key: number): StartedCommand[];
  /** Write a chat's children onto the records of the runs that started them. Retried, then logged. */
  persist?(rootChatId: number, children: PersistedChild[]): Promise<void> | void;
  log?(line: string): void;
}

/** How many times one persist is tried before it is logged as lost. */
export const PERSIST_ATTEMPTS = 3;

export interface ChildLedger {
  spawned(child: LedgerSpawn): void;
  /** The child settled; `deliveredBy` is how its report reached the owner. */
  settled(key: number, report: ChildReport, deliveredBy: "wait" | "inbox"): void;
  /** The owner's live children, as the duplicate-command rule reads them. */
  liveWork(ownerKey: number): LiveChildWork[];
  /** Every child a chat started this session, as persisted. */
  childrenOf(rootChatId: number): PersistedChild[];
  /** Resolves once every persist queued so far (for one chat, or all) has been written or given up. */
  flush(rootChatId?: number): Promise<void>;
}

interface Entry {
  key: number;
  ownerKey: number;
  rootChatId: number;
  /** The whole brief — the persisted copy is clipped, the duplicate rule reads all of it. */
  brief: string;
  child: PersistedChild;
}

export function createChildLedger(ports: ChildLedgerPorts = {}): ChildLedger {
  const entries = new Map<number, Entry>();

  const childrenOf = (rootChatId: number): PersistedChild[] =>
    [...entries.values()].filter((e) => e.rootChatId === rootChatId).map((e) => e.child);

  /** Per chat, the tail of its serial write queue. */
  const queues = new Map<number, Promise<void>>();

  /** One write of the chat's children AS THEY ARE NOW, tried {@link PERSIST_ATTEMPTS} times; never rejects. */
  const write = async (rootChatId: number): Promise<void> => {
    for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt += 1) {
      try {
        await ports.persist!(rootChatId, childrenOf(rootChatId));
        return;
      } catch (error) {
        if (attempt === PERSIST_ATTEMPTS) {
          ports.log?.(`[child ledger] persisting chat ${rootChatId}'s sub-agents failed after ${PERSIST_ATTEMPTS} attempts: ${String(error)}`);
        }
      }
    }
  };

  const persist = (rootChatId: number): void => {
    if (!ports.persist) return;
    const next = (queues.get(rootChatId) ?? Promise.resolve()).then(() => write(rootChatId));
    queues.set(rootChatId, next);
    void next.then(() => {
      if (queues.get(rootChatId) === next) queues.delete(rootChatId);
    });
  };

  return {
    spawned(s) {
      entries.set(s.key, {
        key: s.key,
        ownerKey: s.ownerKey,
        rootChatId: s.rootChatId,
        brief: s.brief,
        child: {
          handle: s.handle,
          label: s.label,
          owner: s.owner,
          brief: s.brief.length > PERSISTED_BRIEF_CHARS ? `${s.brief.slice(0, PERSISTED_BRIEF_CHARS)}… [brief cut]` : s.brief,
          role: s.role,
          ...(s.ticket ? { ticket: s.ticket } : {}),
          state: "running",
        },
      });
      persist(s.rootChatId);
    },

    settled(key, report, deliveredBy) {
      const entry = entries.get(key);
      if (!entry || entry.child.state !== "running") return;
      entry.child = { ...entry.child, state: report.state, deliveredBy, report };
      persist(entry.rootChatId);
    },

    liveWork(ownerKey) {
      return [...entries.values()]
        .filter((e) => e.ownerKey === ownerKey && e.child.state === "running")
        .map((e) => ({ handle: e.child.handle, brief: e.brief, started: ports.startedCommands?.(e.key) ?? [] }));
    },

    childrenOf,

    async flush(rootChatId) {
      await Promise.all(rootChatId == null ? [...queues.values()] : [queues.get(rootChatId)]);
    },
  };
}
