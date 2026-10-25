/**
 * The VS Code `ContextSource` (PRD 35 §3.2, §6.10, E2): the task context pack, built
 * ONCE before turn 1 in one parallel fan-out with no model call.
 *
 *   focus files ─┐
 *   chat state ──┤ each part optional, all under ONE deadline (~1.5 s): a slow or failed
 *   git state ───┤ part is left out, never waited on, never a run failure
 *   codemap facts┘ (after focus: the areas come from the focus files)
 *
 * Skipped entirely when the run has no project and names no file. Rendered by the pure
 * `renderContextPack`; the host hands the block to the volatile turn-context seam and
 * the recall hint to Evermind (`BrainRunRequest.recallHint`).
 */

import * as fs from "node:fs/promises";
import type * as vscode from "vscode";
import type { ServedRead } from "@seanhogg/builderforce-brain-embedded";
import { extractSymbols } from "@builderforce/agent-tools";
import { recallProjectFacts } from "../bfApi";
import { readChatState } from "./chatStateReads";
import { readCheckoutState } from "./checkoutState";
import { areasNamed, codemapFactsFor } from "./codemapFacts";
import { extractFocusPaths, resolveUnderRoot, workspaceRelative } from "./focusPaths";
import {
  FOCUS_INLINE_CHARS,
  contextPackRecallHint,
  renderContextPack,
  type ContextPackChat,
  type ContextPackFocus,
  type ContextPackParts,
  type ContextPackRepo,
} from "./renderContextPack";

/** The whole fan-out's budget. A pack that is late is a pack without that part. */
export const CONTEXT_PACK_DEADLINE_MS = 1_500;
/** A file larger than this is not read at all — its outline would not be worth the read. */
const MAX_FOCUS_BYTES = 2_000_000;
/** Facts pulled before the area filter keeps the codemap ones. */
const FACTS_PULLED = 20;

export interface ContextPackInput {
  root: string;
  /** The user's request for this run. */
  request: string;
  projectId?: number;
  /** The run's SERVER chat — null for an unbound chat (no chat state to read). */
  serverChatId: number | null;
  /** The chat's Memory switch: off ⇒ no project facts are read into the pack. */
  memory: boolean;
}

export interface ContextPackResult {
  /** The rendered pack, '' when nothing was gathered. */
  block: string;
  /** Focus paths + top headings, for the Evermind recall query. */
  recallHint: string;
  dropped: string[];
  /** The focus files the block carries whole — recorded as the run's reads (E2 ↔ E1). */
  servedReads: ServedRead[];
}

/** `p`, or `fallback` once `deadline` passes or `p` throws. */
function within<T>(p: Promise<T>, deadline: Promise<void>, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), deadline.then(() => fallback)]);
}

/** One named file: whole when small, otherwise its outline. undefined = not a readable file. */
export async function loadFocusFile(root: string, candidate: string): Promise<{ focus: ContextPackFocus; text: string } | undefined> {
  const abs = resolveUnderRoot(root, candidate);
  if (!abs) return undefined;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile() || stat.size > MAX_FOCUS_BYTES) return undefined;
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) return undefined;
    const text = buf.toString("utf8");
    const rel = workspaceRelative(root, abs);
    const outline = extractSymbols(rel, text).map((s) => ({ heading: s.kind === "heading" ? s.name : `${s.kind} ${s.name}`, line: s.line }));
    return {
      focus: {
        path: rel,
        totalLines: text.split(/\r?\n/).length,
        ...(text.length <= FOCUS_INLINE_CHARS ? { content: text } : {}),
        outline,
      },
      text,
    };
  } catch {
    return undefined;
  }
}

/** Build the pack. undefined when there is nothing to build it from (no project, no file). */
export async function buildContextPack(
  secrets: vscode.SecretStorage,
  input: ContextPackInput,
  deadlineMs: number = CONTEXT_PACK_DEADLINE_MS,
): Promise<ContextPackResult | undefined> {
  const candidates = input.root ? extractFocusPaths(input.request) : [];
  if (input.projectId == null && candidates.length === 0) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, deadlineMs);
  });
  try {
    const focusLoad = Promise.all(candidates.map((c) => loadFocusFile(input.root, c))).then((all) => all.filter((f): f is NonNullable<typeof f> => !!f));
    const projectId = input.projectId;
    const facts: Promise<Array<{ key: string; content: string }>> = projectId == null || !input.memory
      ? Promise.resolve([])
      : focusLoad.then(async (loaded) => {
          const areas = areasNamed(loaded.map((f) => f.focus.path), loaded.map((f) => f.text));
          if (areas.length === 0) return [];
          const pulled = await recallProjectFacts(secrets, projectId, areas.join(" "), FACTS_PULLED);
          return codemapFactsFor(pulled, areas);
        });
    const [loaded, chat, repos, codemap] = await Promise.all([
      within(focusLoad, deadline, []),
      input.serverChatId != null ? within<ContextPackChat | undefined>(readChatState(secrets, input.serverChatId), deadline, undefined) : Promise.resolve(undefined),
      within<ContextPackRepo[]>(readCheckoutState(), deadline, []),
      within<Array<{ key: string; content: string }>>(facts, deadline, []),
    ]);
    const parts: ContextPackParts = {
      focus: loaded.map((f) => f.focus),
      ...(chat ? { chat } : {}),
      ...(repos.length ? { repos } : {}),
      facts: codemap.map((f) => ({ key: f.key, content: f.content })),
    };
    const rendered = renderContextPack(parts);
    const servedReads = parts.focus.flatMap((f) =>
      f.content !== undefined && rendered.inlined.includes(f.path) ? [{ path: f.path, content: f.content, totalLines: f.totalLines }] : []);
    return { block: rendered.block, recallHint: contextPackRecallHint(parts), dropped: rendered.dropped, servedReads };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
