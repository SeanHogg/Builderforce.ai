/**
 * The Visualizer's agent runs (PRD 46 §3.4): the recent local chats that ran tools, and what each run did wrong.
 *
 * A run is a local chat with durable step rows. Its report reads the chat's messages once,
 * `traceWithPersistedSteps(messages, [])` → `detectRunFindings`, and is memoised by (chat id, last message seq): a run
 * that has not moved is never recomputed, and the list's summaries come from the same memo. No `vscode` here — the
 * bridge hands in the chat store and the project to scope by.
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
const CHATS_SCANNED = 60;

export type AgentRunsStore = Pick<BrainPersistenceAdapter, "listChats" | "getMessages">;

export interface AgentRuns {
  list(): Promise<RunFindingsSummary[]>;
  report(id: string): Promise<RunFindingsReport | null>;
}

const lastSeq = (messages: readonly BrainMessage[]): number => messages.reduce((max, m) => Math.max(max, m.seq), -1);

/**
 * @param store the local chat store (`localBrainApplication(ctx).persistence`)
 * @param projectId the Visualizer's linked project, when there is one; its chats only
 */
export function createAgentRuns(store: AgentRunsStore, projectId: () => number | string | undefined): AgentRuns {
  const memo = new Map<number, { seq: number; report: RunFindingsReport }>();

  /** The chat's report, recomputed only when its last message moved; null when it ran no tools. */
  async function reportOf(chat: Pick<BrainChat, "id" | "title">): Promise<RunFindingsReport | null> {
    const messages = await store.getMessages(chat.id);
    if (!messages.some(isStepMessage)) return null;
    const seq = lastSeq(messages);
    const hit = memo.get(chat.id);
    if (hit && hit.seq === seq) {
      return hit.report.summary.title === chat.title ? hit.report : { ...hit.report, summary: { ...hit.report.summary, title: chat.title } };
    }
    const report = detectRunFindings(traceWithPersistedSteps(messages, []), messages, { id: String(chat.id), title: chat.title });
    memo.set(chat.id, { seq, report });
    return report;
  }

  async function chats(): Promise<BrainChat[]> {
    const project = projectId();
    return store.listChats({ ...(project !== undefined ? { projectId: String(project) } : {}), limit: CHATS_SCANNED });
  }

  return {
    async list() {
      const out: RunFindingsSummary[] = [];
      for (const chat of await chats()) {
        if (out.length >= AGENT_RUNS_SHOWN) break;
        const report = await reportOf(chat);
        if (report) out.push(report.summary);
      }
      return out;
    },
    async report(id) {
      const chatId = Number(id);
      if (!Number.isInteger(chatId)) return null;
      const chat = (await chats()).find((c) => c.id === chatId) ?? (await store.listChats()).find((c) => c.id === chatId);
      return chat ? reportOf(chat) : null;
    },
  };
}
