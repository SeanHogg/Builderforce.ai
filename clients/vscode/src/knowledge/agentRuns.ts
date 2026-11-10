/**
 * The Visualizer's agent runs (PRD 46 §3.4): the recent local chats that ran tools, and what each run did wrong.
 *
 * A run is a local chat with durable step rows. Its report reads the chat's messages once,
 * `traceWithPersistedSteps(messages, [])` → `detectRunFindings`, and is memoised by (chat id, chat `updatedAt`): the
 * store stamps `updatedAt` on every message append, so a chat whose stamp has not moved is answered from the memo
 * without reading its messages again — including the "not a run" verdict. The memo is an LRU of {@link MEMO_SIZE}
 * chats. No `vscode` here — the bridge hands in the chat store and the project to scope by.
 */

import { isStepMessage, type BrainChat, type BrainPersistenceAdapter } from "@seanhogg/builderforce-brain-embedded";
import {
  detectRunFindings,
  traceWithPersistedSteps,
  type RunFindingsReport,
  type RunFindingsSummary,
} from "@seanhogg/builderforce-brain-embedded/runFindings";

/** How many runs the list shows. */
export const AGENT_RUNS_SHOWN = 20;
/** How many recent chats the list looks through for runs (a chat with no step rows is not a run). */
const CHATS_SCANNED = 60;
/** How many chats' verdicts the memo keeps (least recently used goes first). */
export const MEMO_SIZE = 60;

export type AgentRunsStore = Pick<BrainPersistenceAdapter, "listChats" | "getChat" | "getMessages">;

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

  function remember(id: number, entry: { updatedAt: string; report: RunFindingsReport | null }): void {
    memo.delete(id);
    memo.set(id, entry);
    while (memo.size > MEMO_SIZE) memo.delete(memo.keys().next().value!);
  }

  /** The chat's report, recomputed only when the chat's `updatedAt` moved; null when it ran no tools. */
  async function reportOf(chat: ChatRef): Promise<RunFindingsReport | null> {
    const hit = memo.get(chat.id);
    if (hit && hit.updatedAt === chat.updatedAt) {
      remember(chat.id, hit);
      return hit.report;
    }
    const messages = await store.getMessages(chat.id);
    const report = messages.some(isStepMessage)
      ? detectRunFindings(traceWithPersistedSteps(messages, []), messages, { id: String(chat.id), title: chat.title })
      : null;
    remember(chat.id, { updatedAt: chat.updatedAt, report });
    return report;
  }

  return {
    async list() {
      const project = projectId();
      const chats = await store.listChats({ ...(project !== undefined ? { projectId: String(project) } : {}), limit: CHATS_SCANNED });
      const out: RunFindingsSummary[] = [];
      for (const chat of chats) {
        if (out.length >= AGENT_RUNS_SHOWN) break;
        const report = await reportOf(chat);
        if (report) out.push(report.summary);
      }
      return out;
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
