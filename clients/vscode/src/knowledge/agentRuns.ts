/**
 * The Visualizer's agent runs (PRD 46 §3.4): the recent local chats that ran tools, and what each run did wrong.
 *
 * A run is a local chat with durable step rows. Its report reads the chat's messages once,
 * `traceWithPersistedSteps(messages, [])` → `detectRunFindings`, and is memoised by (chat id, chat `updatedAt`): the
 * store stamps `updatedAt` on every message append, so a chat whose stamp has not moved is answered from the memo
 * without reading its messages again — including the "not a run" verdict. The memo is an LRU of {@link MEMO_SIZE}
 * chats. No `vscode` here — the bridge hands in the chat store and the project to scope by.
 *
 * The list looks through the {@link CHATS_SCANNED} most recent chats and reads the messages of every one the memo
 * does not hold in ONE batch (`getMessagesForChats`: one store read, each chat through the store's chat index — a
 * chat's read costs that chat, never every chat's rows). A store without the batch read, or a batch that fails, is
 * read chat by chat; a chat whose read fails is skipped rather than failing the list, and overlapping list calls
 * share one read.
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
export const CHATS_SCANNED = 60;
/** How many chats' verdicts the memo keeps (least recently used goes first). */
export const MEMO_SIZE = 60;

export type AgentRunsStore = Pick<BrainPersistenceAdapter, "listChats" | "getChat" | "getMessages" | "getMessagesForChats">;

export interface AgentRuns {
  list(): Promise<RunFindingsSummary[]>;
  report(id: string): Promise<RunFindingsReport | null>;
}

type ChatRef = Pick<BrainChat, "id" | "title" | "updatedAt">;

/**
 * @param store the local chat store (`localBrainApplication(ctx).persistence`)
 * @param projectId the Visualizer's linked project, when there is one; its chats only
 */
export function createAgentRuns(store: AgentRunsStore, projectId: () => number | string | undefined): AgentRuns {
  /** Insertion order is recency: a hit is re-inserted, the first key is the eviction victim. */
  const memo = new Map<number, { updatedAt: string; report: RunFindingsReport | null }>();
  /** The list read under way: a drawer reopened (or a second panel) while it runs shares it. */
  let listing: Promise<RunFindingsSummary[]> | undefined;

  const memoHit = (chat: ChatRef): boolean => memo.get(chat.id)?.updatedAt === chat.updatedAt;

  /** The messages of the chats the memo cannot answer, in one read; undefined when the store cannot batch. */
  async function readBatch(chats: readonly ChatRef[]): Promise<ReadonlyMap<number, BrainMessage[]> | undefined> {
    const fresh = chats.filter((chat) => !memoHit(chat)).map((chat) => chat.id);
    if (fresh.length === 0 || !store.getMessagesForChats) return undefined;
    // A failed batch is not a failed list: every chat is then read on its own (and fails on its own).
    return store.getMessagesForChats(fresh).catch(() => undefined);
  }

  async function listRuns(): Promise<RunFindingsSummary[]> {
    const project = projectId();
    const chats = await store.listChats({ ...(project !== undefined ? { projectId: String(project) } : {}), limit: CHATS_SCANNED });
    const batch = await readBatch(chats);
    const out: RunFindingsSummary[] = [];
    for (const chat of chats) {
      if (out.length >= AGENT_RUNS_SHOWN) break;
      // One chat that cannot be read (deleted meanwhile, a damaged row) is left out, not the whole list.
      const report = await reportOf(chat, batch?.get(chat.id)).catch(() => null);
      if (report) out.push(report.summary);
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
   * messages, when the list already batch-read them.
   */
  async function reportOf(chat: ChatRef, read?: BrainMessage[]): Promise<RunFindingsReport | null> {
    const hit = memo.get(chat.id);
    if (hit && hit.updatedAt === chat.updatedAt) {
      remember(chat.id, hit);
      return hit.report;
    }
    const messages = read ?? await store.getMessages(chat.id);
    const report = messages.some(isStepMessage)
      ? detectRunFindings(traceWithPersistedSteps(messages, []), messages, { id: String(chat.id), title: chat.title })
      : null;
    remember(chat.id, { updatedAt: chat.updatedAt, report });
    return report;
  }

  return {
    list() {
      listing ??= listRuns().finally(() => { listing = undefined; });
      return listing;
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
