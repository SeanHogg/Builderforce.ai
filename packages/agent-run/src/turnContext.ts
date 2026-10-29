/**
 * What the model reads besides the transcript: the system prompt (persona, then task)
 * and the volatile turn-context tail, rebuilt for every request and never part of the
 * cached prefix.
 *
 * The tail follows the ONE volatile-tail convention (`@seanhogg/builderforce-memory/
 * handoff` `volatileTail`): a single `user` row opened by the `<run-state>` tag,
 * appended AFTER the history, built per request and NEVER persisted into the
 * transcript. Both readers of that convention depend on it — the gateway's prompt
 * caching puts the history breakpoint before the tagged block (an untagged or
 * mid-transcript block that changes every turn re-bills the whole prefix), and the
 * packer never mistakes a tagged block for the user's latest directive.
 */

import { renderPolicyDirectives, type ToolSchema } from "@builderforce/agent-tools";
import { volatileTail } from "@seanhogg/builderforce-memory/handoff";

import type { ContextPack, RunMessage, RunPolicy, RunState, RunTask } from "./contract.js";
import type { PolicyHooks } from "./policy/index.js";
import { policyContext, type RunAgentInput } from "./runContext.js";

/** The pack a run carries when its source has nothing (or cannot build). */
export const EMPTY_PACK: ContextPack = { focus: [], facts: [], recall: [] };

/**
 * Build the context pack ONCE, before turn 1, with no model call (§6.10): the adapter's
 * `ContextSource`, then the context policy's recall lines appended. The recall hook is
 * handed a context source that answers the pack already built, so the source is asked
 * exactly once per run. A source that throws yields the empty pack — the task still has
 * its prompt, and a missing context is the model's to notice, not a failed run.
 */
export async function buildContextPack(input: RunAgentInput, hooks: PolicyHooks, state: RunState, offered: ToolSchema[]): Promise<ContextPack> {
  let pack: ContextPack;
  try {
    pack = await input.ports.context.pack(input.task);
  } catch {
    pack = EMPTY_PACK;
  }
  const built = pack;
  const once: RunAgentInput = { ...input, ports: { ...input.ports, context: { pack: () => built } } };
  let recalled: readonly string[] | void = undefined;
  try {
    recalled = await hooks.context.recall(policyContext(once, state, { messages: [], tools: offered }, state.step, 0));
  } catch {
    recalled = undefined; // recall is best-effort; it never fails a run
  }
  return recalled && recalled.length > 0 ? { ...pack, recall: [...pack.recall, ...recalled] } : pack;
}

/**
 * The system prompt: the governance gates the run is bound by, then the persona, then the
 * task. The context pack is NOT here — it is volatile.
 */
export function systemPrompt(task: RunTask, gates?: RunPolicy["approvalGates"]): string {
  const parts: string[] = [];
  const governance = renderPolicyDirectives(gates);
  if (governance) parts.push(governance);
  if (task.persona && task.persona.trim()) parts.push(task.persona.trim());
  parts.push(task.prompt);
  return parts.join("\n\n");
}

/**
 * The turn-context sections, from the pack and the memory brief, or null when there is
 * nothing to say.
 */
export function turnContextBlock(pack: ContextPack, brief: string | null): string | null {
  const lines: string[] = [];
  for (const file of pack.focus) {
    if (file.content !== undefined) {
      lines.push(`## ${file.path}`, file.content);
    } else if (file.outline && file.outline.length > 0) {
      lines.push(`## ${file.path} (outline)`);
      for (const entry of file.outline) lines.push(`- ${entry.heading} (line ${entry.line})`);
    }
  }
  if (pack.chat) {
    lines.push(`## chat`, `${pack.chat.tickets.length} linked tickets, ${pack.chat.runs.length} runs`);
  }
  for (const repo of pack.repos ?? []) {
    lines.push(`## repo ${repo.repo}`, `branch ${repo.branch}`, repo.dirty.length > 0 ? `dirty: ${repo.dirty.join(", ")}` : "clean");
  }
  for (const fact of pack.facts) lines.push(`## ${fact.key}`, fact.content);
  if (pack.recall.length > 0) lines.push("## recall", ...pack.recall);
  if (brief && brief.trim()) lines.push("## brief", brief.trim());
  if (lines.length === 0) return null;
  return lines.join("\n");
}

/**
 * The messages one request carries: the transcript as it stands plus this turn's
 * volatile tail, LAST. The transcript itself is never touched, so the saved state (and
 * the cached prefix) holds no per-turn context and a resumed tick rebuilds the same tail
 * from the persisted pack.
 */
export function withVolatileTail(transcript: readonly RunMessage[], pack: ContextPack, brief: string | null): RunMessage[] {
  const tail = volatileTail([turnContextBlock(pack, brief)]);
  return tail ? [...transcript, tail] : [...transcript];
}
