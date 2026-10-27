/**
 * `local_research` — the paid model asks, a LOCAL model on this machine reads the files
 * and answers. Free tokens doing the reading the paid model would otherwise pay for.
 *
 *   question ─► files: the caller's `paths`, else a deterministic pre-search
 *               (symbol index + text search over the question's identifiers)
 *            ─► cache: (question, each file's path+mtime+size) — a hit costs nothing
 *            ─► excerpts: windows around the hits (or the file head), bounded for a
 *               small local context window
 *            ─► the local model answers from the excerpts only
 *
 * When the local model runs out of time (or fails) the deterministic hits are returned
 * as a PARTIAL success: the caller still learns where to look. Requires capability
 * `local.research`, which a surface advertises only while a local runtime can serve.
 */

import type { LocalResearchMessage } from "./research-capability.js";
import { preSearch, preSearchFiles, type PreSearchResult } from "./preSearch.js";
import { researchCacheKey } from "./researchCache.js";
import { defineTool, type ToolDefinition, type ToolResult, type ToolContext } from "./tool.js";

const MAX_PATHS = 8;
const DEFAULT_TIME_LIMIT_MS = 45_000;
/** The excerpt budget: small local models have small windows. ~6k tokens. */
const EXCERPT_BUDGET_CHARS = 24_000;
/** Lines kept on each side of a hit. */
const HIT_WINDOW_LINES = 30;

const SYSTEM = [
  "You answer a question about a codebase using ONLY the file excerpts given.",
  "Cite every claim as path:line. Be brief and concrete: names, locations, what calls what.",
  "If the excerpts do not contain the answer, say exactly what is missing — never guess.",
].join(" ");

interface Excerpt {
  path: string;
  text: string;
}

/** Line windows of `content` around `lines` (1-based), merged, numbered, within `budget`. */
export function excerptAround(content: string, lines: readonly number[], budget: number, radius = HIT_WINDOW_LINES): string {
  const all = content.split(/\r?\n/);
  const ranges: Array<[number, number]> = [];
  const anchors = lines.length > 0 ? [...lines].sort((a, b) => a - b) : [1];
  for (const line of anchors) {
    const start = Math.max(1, lines.length > 0 ? line - radius : 1);
    const end = Math.min(all.length, lines.length > 0 ? line + radius : radius * 4);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  const out: string[] = [];
  let used = 0;
  for (const [start, end] of ranges) {
    if (out.length > 0) out.push("…");
    for (let n = start; n <= end; n++) {
      const row = `${n}: ${all[n - 1] ?? ""}`;
      if (used + row.length + 1 > budget) return `${out.join("\n")}\n…`;
      out.push(row);
      used += row.length + 1;
    }
  }
  return out.join("\n");
}

function hitLinesFor(path: string, hits: PreSearchResult | null): number[] {
  if (!hits) return [];
  return [...hits.definitions, ...hits.references].filter((h) => h.path === path).map((h) => h.line);
}

async function readExcerpts(ctx: ToolContext, files: readonly string[], hits: PreSearchResult | null): Promise<Excerpt[]> {
  const out: Excerpt[] = [];
  const per = Math.floor(EXCERPT_BUDGET_CHARS / Math.max(1, files.length));
  for (const path of files) {
    const r = await ctx.caps.repoRead!.readFile(path).catch(() => null);
    if (!r?.ok || typeof r.content !== "string") continue;
    out.push({ path, text: excerptAround(r.content, hitLinesFor(path, hits), per) });
  }
  return out;
}

function researchMessages(question: string, excerpts: readonly Excerpt[]): LocalResearchMessage[] {
  const body = excerpts.map((e) => `### ${e.path}\n${e.text}`).join("\n\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Question: ${question}\n\nExcerpts (each line is "line: text"):\n\n${body}` },
  ];
}

/** `signal` aborted for ANY reason other than the caller's own stop. */
function deadlineSignal(limitMs: number, outer?: AbortSignal): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort(new Error("local_research time limit"));
  }, limitMs);
  const onOuter = () => ctl.abort(outer?.reason);
  if (outer?.aborted) ctl.abort(outer.reason);
  else outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: ctl.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

export const localResearchTool: ToolDefinition = defineTool({
  name: "local_research",
  description:
    "Ask a question about this codebase and have a LOCAL model on this machine read the relevant files and answer it — free, no paid tokens. Name the files in `paths`; without them, files are chosen by a symbol-index + text search for the identifiers in the question. Use it for \"how does X work\", \"what calls Y\", \"summarize these files\" before reading large files yourself. Answers cite path:line and are cached until a file changes. If the local model runs out of time you get the search hits instead.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "What you want to know, naming identifiers where you can, e.g. \"how does resolveMembership pick the tenant?\"." },
      paths: { type: "array", items: { type: "string" }, description: `Optional repo-relative files to read (max ${MAX_PATHS}).` },
    },
    required: ["question"],
  },
  requires: ["repo.read", "local.research"],
  async execute(args, ctx): Promise<ToolResult> {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    if (!question) return { data: { ok: false, error: "question is required" } };
    const research = ctx.caps.research;
    if (!research) return { data: { ok: false, error: "No local model is available on this machine right now." } };
    const named = Array.isArray(args.paths)
      ? [...new Set(args.paths.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim()))].slice(0, MAX_PATHS)
      : [];
    // Deterministic hits: they pick the files when none were named, anchor the excerpts,
    // and are the partial answer when the model cannot finish.
    // The run's Stop reaches the searcher, so a stopped run leaves no text search behind.
    const hits = await preSearch(question, {
      ...(ctx.caps.symbols ? { findSymbol: (q: string) => ctx.caps.symbols!.find(q, { limit: 20 }) } : {}),
      ...(ctx.caps.repoRead ? { searchText: (q: string, signal?: AbortSignal) => ctx.caps.repoRead!.searchCode(q, undefined, signal ? { signal } : undefined) } : {}),
    }, ctx.signal ? { signal: ctx.signal } : {}).catch(() => null);
    const chosen = named.length > 0 ? named : hits ? preSearchFiles(hits) : [];
    if (chosen.length === 0) {
      return { data: { ok: false, question, error: "No files matched the question — pass `paths`, or name an identifier from the code." } };
    }
    const fingerprints = await research.fingerprint(chosen);
    const files = fingerprints.map((f) => f.path);
    if (files.length === 0) return { data: { ok: false, question, error: `None of these files could be read: ${chosen.join(", ")}` } };
    const key = researchCacheKey(question, fingerprints);
    const cached = await research.cache?.get(key).catch(() => undefined);
    if (cached) return { data: { ok: true, question, files, answer: cached, cached: true } };

    const excerpts = await readExcerpts(ctx, files, hits);
    const deadline = deadlineSignal(research.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS, ctx.signal);
    const partial = (reason: string): ToolResult => ({
      data: { ok: true, partial: true, question, files, reason, ...(hits?.block ? { hits: hits.block } : {}), note: "The local model did not finish — these are the deterministic search hits. Read the files they name directly." },
    });
    try {
      // Raced against the deadline: a runtime that ignores its signal still cannot hold the turn.
      const stopped = new Promise<never>((_, reject) => {
        if (deadline.signal.aborted) reject(deadline.signal.reason ?? new Error("aborted"));
        deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason ?? new Error("aborted")), { once: true });
      });
      stopped.catch(() => undefined);
      const answer = (await Promise.race([research.complete(researchMessages(question, excerpts), deadline.signal), stopped])).trim();
      if (!answer) return partial("the local model returned an empty answer");
      await research.cache?.set(key, answer).catch(() => undefined);
      return { data: { ok: true, question, files, answer } };
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      return partial(deadline.timedOut() ? "the local model ran out of time" : `the local model failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      deadline.dispose();
    }
  },
});
