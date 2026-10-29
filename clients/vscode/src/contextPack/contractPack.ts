/**
 * The task context pack as the ONE agent's `ContextPack` (PRD 35 §3.2) — the structured
 * twin of the rendered block (`renderContextPack.ts`). The agent renders the volatile
 * turn-context block from this itself; the adapter only hands the parts over, in the
 * contract's shape. Pure: parts in, pack out.
 */

import type { ContextPack } from "@seanhogg/builderforce-brain-embedded";
import type { ContextPackParts } from "./renderContextPack";

/** The contract's pack for these parts. `recall` is the agent's to fill (queried with the prompt and the focus terms). */
export function contractContextPack(parts: ContextPackParts): ContextPack {
  return {
    focus: parts.focus.map((f) => ({
      path: f.path,
      ...(f.content !== undefined ? { content: f.content } : {}),
      ...(f.outline ? { outline: f.outline } : {}),
    })),
    ...(parts.chat ? { chat: { tickets: parts.chat.tickets, runs: parts.chat.runs ?? [] } } : {}),
    ...(parts.repos?.length ? { repos: parts.repos.map((r) => ({ repo: r.repo, branch: r.branch ?? "", dirty: r.dirty })) } : {}),
    facts: parts.facts.map((f) => ({ key: f.key, content: f.content })),
    recall: [],
  };
}
