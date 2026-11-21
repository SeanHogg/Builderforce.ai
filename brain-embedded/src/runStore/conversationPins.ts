/**
 * conversationPins — the tools an EARLIER turn of this conversation called or named, kept advertised on this run.
 *
 * A run's own calls pin themselves (`usedTools`, `callPostStep`), but a run starts with none: a tool the previous turn
 * called, or one the assistant named in its reply ("I'll archive them with builtin_tasks_archive_many"), fell back to
 * competing on relevance against a follow-up like "yes, do it" — and lost the cut, so the model narrated a tool it was
 * not offered (`narratedUnadvertised`). The shared server loop already pins every call in its messages
 * (`@builderforce/agent-run` `policy/tools/index.ts` `pinnedNames`); this is the Brain's same rule over the conversation
 * that precedes the current request, plus the tools its user and assistant turns mention in prose: an advertised
 * identifier (`builtin_*` / `mcp__*`, `toolNamesMentionedIn`) or a dotted catalog id (`tasks.archive_many`).
 *
 * A routed call (`builtin_tools_invoke`) pins the tool it reached, not the router. Every name — called, advertised or
 * dotted — resolves against the catalog through the shared `resolveAdvertisedToolName`, so only a REAL tool pins
 * (`index.ts` or `e.g` in prose resolves to nothing). Bounded: the last {@link CONVERSATION_PIN_WINDOW} messages,
 * most-recent first, at most {@link CONVERSATION_PIN_LIMIT} names — below the selector's `PINNED_OVERFLOW` (16), so the
 * run's own calls, pinned after these (`brainPlatformTools.ts` `selectionPins`), are never squeezed out.
 */

import { toolNamesMentionedIn } from '@builderforce/agent-stall';
import { resolveAdvertisedToolName } from '@builderforce/agent-tools';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { isRouterTool, TOOL_ROUTER_INVOKE } from '../toolRouter';
import { userTextOf } from './convoText';

/** How many messages before the current request are read for pins. */
export const CONVERSATION_PIN_WINDOW = 20;

/** The most conversation pins a run carries — half the selector's pin overflow, the rest left for the run's own calls. */
export const CONVERSATION_PIN_LIMIT = 8;

/** A dotted catalog id written in prose (`tasks.archive_many`); resolved against the catalog before it pins anything. */
const DOTTED_ID = /\b[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\b/g;

/** The tools a message's prose names: advertised identifiers, then dotted catalog ids, in text order. */
function namedIn(text: string): string[] {
  return [...new Set([...toolNamesMentionedIn(text), ...(text.match(DOTTED_ID) ?? [])])];
}

/** The tool a call reached: the router's `invoke` target, else the call's own name. */
function calledName(call: { function: { name: string; arguments: string } }): string {
  if (call.function.name !== TOOL_ROUTER_INVOKE) return call.function.name;
  try {
    const args = JSON.parse(call.function.arguments || '{}') as { name?: unknown };
    return typeof args.name === 'string' ? args.name : '';
  } catch {
    // Malformed router args name no tool: the call pins nothing, which is the honest reading of it.
    return '';
  }
}

/**
 * Tools called or named in the conversation BEFORE its latest user turn (the current request), newest first,
 * resolved to catalog names and bounded to `limit`.
 */
export function conversationPinnedTools(
  convo: readonly ChatCompletionMessage[],
  catalogToolNames: readonly string[],
  limit: number = CONVERSATION_PIN_LIMIT,
): string[] {
  let current = convo.length;
  for (let i = convo.length - 1; i >= 0; i -= 1) {
    if (convo[i].role === 'user') { current = i; break; }
  }
  const known = new Set(catalogToolNames);
  const out: string[] = [];
  const add = (raw: string): void => {
    if (out.length >= limit || !raw) return;
    const name = resolveAdvertisedToolName(raw, known);
    if (!name || isRouterTool(name) || out.includes(name)) return;
    out.push(name);
  };
  const start = Math.max(0, current - CONVERSATION_PIN_WINDOW);
  for (let i = current - 1; i >= start && out.length < limit; i -= 1) {
    const m = convo[i];
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    for (const call of [...(m.tool_calls ?? [])].reverse()) add(calledName(call));
    for (const named of namedIn(userTextOf(m)).reverse()) add(named);
  }
  return out;
}
