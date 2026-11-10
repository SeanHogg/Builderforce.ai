/**
 * The Visualizer's agent runs (PRD 46 §3.4): the recent local chats that ran tools, and what each run did wrong.
 *
 * A run is a local chat with durable step rows. Its report reads the chat's messages once,
 * `traceWithPersistedSteps(messages, [])` → `detectRunFindings`, and is memoised by (chat id, chat `updatedAt`): the
 * store stamps `updatedAt` on every message append, so a chat whose stamp has not moved is answered from the memo
 * without reading its messages again — including the "not a run" verdict. The memo is an LRU of {@link MEMO_SIZE}
 * chats. No `vscode` here — the bridge hands in the chat store and the project to scope by.
 *
 * Reading: the {@link CHATS_SCANNED} most recent chats, newest first, in windows of {@link READ_WINDOW}. Each window's
 * chats the memo cannot answer are read in ONE batch (`getMessagesForChats`: one store read, each chat through the
 * store's chat index — a chat's read costs that chat, never every chat's rows), and the walk stops as soon as
 * {@link AGENT_RUNS_SHOWN} runs are found, so the older windows are never read. Bounds, kept although the index made a
 * read cheap (measured on a 263 MB / 75k-message store: a cold list 2.1 s, ~1.6 s of it run-findings CPU, warm 0.14 s):
 *   - {@link LIST_BUDGET_MS}: measured from before the chat list read; past it no further chat is read or analysed
 *     (checked per chat; memo hits are still answered; the next open continues);
 *   - {@link LIST_TIMEOUT_MS}: a list that has not settled by then (a store read that hangs) rejects and is dropped,
 *     so Retry starts a fresh read instead of being handed the stuck one; the abandoned list stops between windows
 *     and chats, and a read that lands late is not memoised.
 * A store without the batch read, or a batch that fails, is read chat by chat; a chat whose read fails is skipped
 * rather than failing the list; overlapping list calls for the same project share one read.
 */

import { isStepMessage, type BrainChat, type BrainMessage, type BrainPersistenceAdapter } from "@seanhogg/builderforce-brain-embedded";
import {
  detectRunFindings,
  traceWithPersistedSteps,
  type RunFindingsReport,
  type RunFindingsSummary,
} from "@seanhogg/builderforce-brain-embedded/runFindings";

/** How many runs the list shows. */
export const AGENT_RUNS_SHOWN = 20;
/** How many recent chats the list looks through for runs (a chat with no step rows is not a run). */
export const CHATS_SCANNED = 30;
/** How many chats one batch read covers; the walk stops between windows once enough runs are found. */
export const READ_WINDOW = 10;
/** How long one list may spend reading chats the memo does not hold; past it, only memo hits are answered. */
export const LIST_BUDGET_MS = 5_000;
/** A list not settled by then is rejected and forgotten, so the next `list()` reads afresh. */
export const LIST_TIMEOUT_MS = 20_000;
/** How many chats' verdicts the memo keeps (least recently used goes first). */
export const MEMO_SIZE = 60;

export interface AgentRunsOptions {
  /** {@link LIST_BUDGET_MS} by default; tests pass their own. */
  budgetMs?: number;
  /** {@link LIST_TIMEOUT_MS} by default; tests pass their own. */
  timeoutMs?: number;
  /** The clock the budget is measured on (tests inject one). */
  now?: () => number;
}

export type AgentRunsStore = Pick<BrainPersistenceAdapter, "listChats" | "getChat" | "getMessages" | "getMessagesForChats">;

export interface AgentRuns {
  list(): Promise<RunFindingsSummary[]>;
  report(id: string): Promise<RunFindingsReport | null>;
}

type ChatRef = Pick<BrainChat, "id" | "title" | "updatedAt">;

/** One `list()` in flight; `abandoned` once it timed out, so its late reads stop and are not memoised. */
interface ListRun {
  abandoned: boolean;
}

/** The shared-read key of "no linked project" — never equal to a project id's text. */
const NO_PROJECT = "\u0000all-projects";

export class AgentRunsTimeoutError extends Error {
  constructor(ms: number) {
    super(`agent runs list did not settle in ${ms} ms`);
    this.name = "AgentRunsTimeoutError";
  }
}

/**
 * @param store the local chat store (`localBrainApplication(ctx).persistence`)
 * @param projectId the Visualizer's linked project, when there is one; its chats only
 */
export function createAgentRuns(store: AgentRunsStore, projectId: () => number | string | undefined, options: AgentRunsOptions = {}): AgentRuns {
  const budgetMs = options.budgetMs ?? LIST_BUDGET_MS;
  const timeoutMs = options.timeoutMs ?? LIST_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  /** Insertion order is recency: a hit is re-inserted, the first key is the eviction victim. */
  const memo = new Map<number, { updatedAt: string; report: RunFindingsReport | null }>();
  /** The list read under way per project: a drawer reopened (or a second panel) on the same project shares it. */
  const listing = new Map<string, Promise<RunFindingsSummary[]>>();

  const memoHit = (chat: ChatRef): boolean => memo.get(chat.id)?.updatedAt === chat.updatedAt;

  /** One window's chats the memo cannot answer, in one read; undefined when the store cannot batch (or it failed). */
  async function readWindow(chats: readonly ChatRef[]): Promise<ReadonlyMap<number, BrainMessage[]> | undefined> {
    const fresh = chats.filter((chat) => !memoHit(chat)).map((chat) => chat.id);
    if (fresh.length === 0 || !store.getMessagesForChats) return undefined;
    // A failed batch is not a failed list: its chats are then read one by one (and fail one by one).
    return store.getMessagesForChats(fresh).catch(() => undefined);
  }

  async function listRuns(project: number | string | undefined, run: ListRun): Promise<RunFindingsSummary[]> {
    // The budget covers the whole list, the chat list read included.
    const deadline = now() + budgetMs;
    const chats = await store.listChats({ ...(project !== undefined ? { projectId: String(project) } : {}), limit: CHATS_SCANNED });
    const out: RunFindingsSummary[] = [];
    for (let at = 0; at < chats.length && out.length < AGENT_RUNS_SHOWN; at += READ_WINDOW) {
      if (run.abandoned) return out; // timed out: nobody is waiting, stop reading
      const window = chats.slice(at, at + READ_WINDOW);
      const batch = now() > deadline ? undefined : await readWindow(window);
      for (const chat of window) {
        if (out.length >= AGENT_RUNS_SHOWN || run.abandoned) break;
        // Out of budget (checked per chat): a memo hit is free; anything else waits for the next open.
        if (!memoHit(chat) && now() > deadline) continue;
        // One chat that cannot be read (deleted meanwhile, a damaged row) is left out, not the whole list.
        const report = await reportOf(chat, batch?.get(chat.id), run).catch(() => null);
        if (report) out.push(report.summary);
      }
    }
    return out;
  }

  function remember(id: number, entry: { updatedAt: string; report: RunFindingsReport | null }): void {
    memo.delete(id);
    memo.set(id, entry);
    while (memo.size > MEMO_SIZE) memo.delete(memo.keys().next().value!);
  }

  /**
   * The chat's report, recomputed only when the chat's `updatedAt` moved; null when it ran no tools. `read`: its
   * messages, when the list already batch-read them. `run`: the list asking — once it is abandoned (timed out), a
   * read that lands late is neither analysed nor memoised.
   */
  async function reportOf(chat: ChatRef, read?: BrainMessage[], run?: ListRun): Promise<RunFindingsReport | null> {
    const hit = memo.get(chat.id);
    if (hit && hit.updatedAt === chat.updatedAt) {
      remember(chat.id, hit);
      return hit.report;
    }
    const messages = read ?? await store.getMessages(chat.id);
    if (run?.abandoned) return null;
    const report = messages.some(isStepMessage)
      ? detectRunFindings(traceWithPersistedSteps(messages, []), messages, { id: String(chat.id), title: chat.title })
      : null;
    remember(chat.id, { updatedAt: chat.updatedAt, report });
    return report;
  }

  /** `work`, or a rejection once {@link LIST_TIMEOUT_MS} passes without it settling — which also abandons `run`. */
  function withTimeout<T>(work: Promise<T>, run: ListRun): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        run.abandoned = true;
        reject(new AgentRunsTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    work.catch(() => undefined); // a late failure of an abandoned list is nobody's to handle
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  return {
    list() {
      const project = projectId();
      const key = project === undefined ? NO_PROJECT : String(project);
      const shared = listing.get(key);
      if (shared) return shared;
      const run: ListRun = { abandoned: false };
      const pending: Promise<RunFindingsSummary[]> = withTimeout(listRuns(project, run), run).finally(() => {
        // Settled or timed out: forget it, so the next list (a Retry) reads afresh.
        if (listing.get(key) === pending) listing.delete(key);
      });
      listing.set(key, pending);
      return pending;
    },
    async report(id) {
      const chatId = Number(id);
      if (!Number.isInteger(chatId)) return null;
      const chat = await store.getChat(chatId).catch(() => undefined);
      if (!chat) return null;
      const project = projectId();
      if (project !== undefined && String(chat.projectId) !== String(project)) return null;
      return reportOf(chat);
    },
  };
}
