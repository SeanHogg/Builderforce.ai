/**
 * Sub-agents journaled WITH their parent run, so no child vanishes with the editor
 * (chat #61651: six children died when the editor closed and the resumed parent never
 * learned they had existed).
 *
 *   - {@link recordRunChildren}: the chat's children (`PersistedChild`, from the ledger in
 *     `childLedger.ts`) written onto the chat's latest `execution` record as `children`.
 *     Every later write to that record (`runRecovery.ts` checkpoints, finish, recovery)
 *     spreads the payload, so the list rides along into the `interrupted` record.
 *   - {@link persistChildrenTo}: that write as the ledger's `persist` port.
 *   - {@link describeInterruptedChildren}: what a resumed parent is told about each child —
 *     finished children's reports delivered, children that died with the editor reported
 *     "interrupted — not resumed; re-spawn or do it yourself" with their brief.
 *
 * No journal event is appended: like a checkpoint, the child list is local resume state,
 * not a lifecycle transition to mirror.
 */

import { childReportText } from "@builderforce/agent-tools";
import { selectRecords, type ExecutionValue, type LocalFirstStore, type LocalRecord } from "@builderforce/local-first";
import type { PersistedChild } from "./childLedger";

/** An execution payload that may carry its run's sub-agents. */
export type ExecutionWithChildren = ExecutionValue & { children?: PersistedChild[] };

/**
 * Write `children` onto the chat's latest execution record (the parent run). A chat with
 * no journaled run (a host that does not journal) is left alone.
 */
export async function recordRunChildren(
  store: LocalFirstStore,
  args: { chatId: string; children: readonly PersistedChild[]; now?: () => Date },
): Promise<void> {
  const at = (args.now?.() ?? new Date()).toISOString();
  await store.transact(async (tx) => {
    const runs = await selectRecords<ExecutionWithChildren>(tx, "execution", (r) => String(r.payload.chatId ?? "") === args.chatId);
    const run = latestRun(runs);
    if (!run) return;
    await tx.put<ExecutionWithChildren>(
      { ...run, version: run.version + 1, updatedAt: at, payload: { ...run.payload, children: [...args.children] } },
      run.version,
    );
  });
}

/** A live run beats a settled one; otherwise the most recently written. */
function latestRun<T extends ExecutionValue>(runs: readonly LocalRecord<T>[]): LocalRecord<T> | undefined {
  const rank = (r: LocalRecord<T>): number => (r.payload.status === "running" ? 1 : 0);
  return [...runs].sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** {@link recordRunChildren} as the ledger's `persist` port (`createChildLedger`). */
export function persistChildrenTo(store: LocalFirstStore, now?: () => Date) {
  return (rootChatId: number, children: PersistedChild[]): Promise<void> =>
    recordRunChildren(store, { chatId: String(rootChatId), children, ...(now ? { now } : {}) });
}

/** The children journaled with a run record. */
export function childrenOfRecord(record: Pick<LocalRecord<ExecutionValue>, "payload">): PersistedChild[] {
  const children = (record.payload as ExecutionWithChildren).children;
  return Array.isArray(children) ? children : [];
}

/** What a child that died with the editor tells its resumed owner. */
export const INTERRUPTED_CHILD_NOTE = "interrupted — not resumed; re-spawn or do it yourself";

/**
 * What a resumed parent is told about the sub-agents its interrupted run had started:
 * every child accounted for — reports of the finished ones delivered (or noted as already
 * returned by `wait_agents`), and every child that was still running reported as
 * interrupted with its brief. Empty when the run started none.
 */
export function describeInterruptedChildren(record: Pick<LocalRecord<ExecutionValue>, "payload">): string {
  const children = childrenOfRecord(record);
  if (!children.length) return "";
  const sections = children.map((c) => {
    const who = `${c.handle} (${c.label}${c.ticket ? `, ticket ${c.ticket}` : ""}; started by ${c.owner})`;
    if (c.state === "running") return `- ${who}: ${INTERRUPTED_CHILD_NOTE}. Its brief was:\n${indent(c.brief)}`;
    if (c.deliveredBy === "wait") return `- ${who}: ${c.state} — its report was already returned to you by wait_agents.`;
    return c.report ? `- ${who}: ${c.state} — its report:\n${indent(childReportText(c.report))}` : `- ${who}: ${c.state}, no report kept.`;
  });
  const died = children.filter((c) => c.state === "running").length;
  return [
    `Your interrupted run had started ${children.length} sub-agent${children.length === 1 ? "" : "s"}${died ? `; ${died} died with the editor and are NOT running now` : ""}:`,
    ...sections,
  ].join("\n");
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join("\n");
}
