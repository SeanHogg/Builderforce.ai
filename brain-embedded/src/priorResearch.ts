/**
 * WHAT THIS CHAT ALREADY READ AND DID — carried into a run that starts from saved history.
 *
 * A run's working transcript holds the real tool rows (every call and its result), but
 * only in memory. When a run starts from the chat's SAVED history — the panel was
 * reloaded, the chat reopened, the editor restarted — the seed is text only: the tool
 * steps are persisted as `role:'tool'` step rows, and those can never re-enter the
 * transcript, because a tool message without the call that produced it is rejected by
 * strict vendors. So the model saw its own earlier promises ("I'll read RoomScene next")
 * and none of what it had read, and started over.
 *
 * Observed 2026-09-13 (chat #105): "continue and build it" re-ran the same searches
 * (`search_code` on `frontend/src` ×13) and read the same three files again, and the
 * run ended having changed nothing.
 *
 * This module turns those step rows back into something the model can use without
 * breaking the transcript: a system-prompt block listing each earlier tool call with a
 * trimmed excerpt of its result, newest first, bounded so it can never crowd out the
 * conversation itself.
 */

import { parseStepMessage } from './persistedSteps';
import { stableStringify } from './stableStringify';
import { isStepMessage, type BrainMessage } from './types';

/** Per-call result excerpt. The stored copy is already capped at 4 KB. */
const ENTRY_RESULT_CHARS = 1_200;
/** Per-call arguments as shown. The dedupe key uses the full arguments. */
const ENTRY_ARGS_CHARS = 200;
/** Whole block — about 3k tokens, well under the transcript's own budget. */
const DIGEST_CHARS = 12_000;
/** Most calls listed. Older ones are the least likely to still be true anyway. */
const MAX_ENTRIES = 40;

const HEADER = [
  '## Already done earlier in this chat',
  'Earlier turns of this conversation already ran the tool calls below (newest first, each result trimmed). Their results are NOT in the transcript above — this list is the record of them.',
  'Build on it. Do not repeat a call listed here to rediscover what it already answered; re-run one only when you need a part of its result that is not shown, or when the target may have changed since (for example, a file this chat has edited).',
].join('\n');

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result) ?? '';
  } catch {
    return String(result);
  }
}

/**
 * The block, or null when the history has no tool steps. Pure: reads only the
 * persisted step rows (`persistedSteps.parseStepMessage`), so a chat reopened on any
 * surface builds the same block from the same rows.
 */
export function priorResearchDigest(history: readonly BrainMessage[]): string | null {
  const entries: string[] = [];
  const seen = new Set<string>();
  let size = HEADER.length;
  for (let i = history.length - 1; i >= 0 && entries.length < MAX_ENTRIES; i -= 1) {
    const message = history[i]!;
    if (!isStepMessage(message)) continue;
    const parsed = parseStepMessage(message.metadata);
    if (!parsed || parsed.step.category !== 'tool') continue;
    const { label, args, result, isError } = parsed.step;
    const fullArgs = args == null ? '' : stableStringify(args);
    // The same call made twice is listed once — its newest result, which is the one
    // that still describes the target.
    const key = `${label}|${fullArgs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = `- ${label}(${clip(fullArgs, ENTRY_ARGS_CHARS)})${isError ? ' — FAILED' : ''}\n  → ${clip(resultText(result), ENTRY_RESULT_CHARS)}`;
    if (size + entry.length + 1 > DIGEST_CHARS) break;
    entries.push(entry);
    size += entry.length + 1;
  }
  return entries.length > 0 ? [HEADER, ...entries].join('\n') : null;
}
