/**
 * What the model reads besides the transcript: the system prompt (persona, then task)
 * and the volatile turn-context block, rebuilt every turn and never part of the cached
 * prefix.
 */

import type { ContextPack, RunMessage, RunTask } from "./contract.js";

/** The system prompt: the persona, then the task. The context pack is NOT here — it is volatile. */
export function systemPrompt(task: RunTask): string {
  const parts: string[] = [];
  if (task.persona && task.persona.trim()) parts.push(task.persona.trim());
  parts.push(task.prompt);
  return parts.join("\n\n");
}

/**
 * The volatile turn-context block. It is rebuilt every turn from the pack and the
 * memory brief, and it is NEVER part of the cached prefix — that is why it is its
 * own message rather than folded into the system prompt.
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
  for (const line of pack.recall) lines.push(line);
  if (brief && brief.trim()) lines.push("## brief", brief.trim());
  if (lines.length === 0) return null;
  return lines.join("\n");
}

/** The volatile block's marker, so a later turn replaces it rather than stacking another. */
const VOLATILE_PREFIX = "<turn-context>";
const VOLATILE_SUFFIX = "</turn-context>";

/** Replace the previous volatile block with this turn's, or append one. */
export function replaceVolatile(transcript: RunMessage[], block: string | null): void {
  const index = transcript.findIndex((row) => row.role === "user" && row.content.startsWith(VOLATILE_PREFIX));
  if (!block) {
    if (index >= 0) transcript.splice(index, 1);
    return;
  }
  const row: RunMessage = { role: "user", content: `${VOLATILE_PREFIX}\n${block}\n${VOLATILE_SUFFIX}` };
  if (index >= 0) transcript[index] = row;
  else transcript.push(row);
}

/**
 * The volatile block's inner content, as saved in a resumed transcript, or null when
 * none is present. A resumed run replays the pack it saved (not a rebuilt one), so the
 * volatile block the last turn wrote is reconstructed instead of being dropped.
 */
export function extractVolatile(transcript: RunMessage[]): ContextPack | null {
  const row = transcript.find((r) => r.role === "user" && r.content.startsWith(VOLATILE_PREFIX) && r.content.endsWith(VOLATILE_SUFFIX));
  if (!row) return null;
  const inner = row.content.slice(VOLATILE_PREFIX.length, row.content.length - VOLATILE_SUFFIX.length).trim();
  // The block's exact pack is not recoverable field-for-field; what matters for trace
  // fidelity is that a non-empty block is re-rendered (a non-empty focus/facts pack),
  // which keeps the resumed run's volatile row from vanishing.
  return inner ? { focus: [{ path: "<resumed>" }], facts: [], recall: [] } : null;
}

