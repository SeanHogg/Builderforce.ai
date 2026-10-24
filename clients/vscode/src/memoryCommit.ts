/**
 * After a file-changing run, write what the run learned as project facts.
 *
 * A finished run used to hope the model called `remember_fact`. That call is
 * optional, so decisions, root causes and conventions left with the turn. This
 * step asks a cheap completion for those facts and writes them itself, under
 * stable `learned:` keys so a later run on the same decision replaces the
 * fact instead of stacking a second one.
 *
 * The completion and the fact write are injected. Tests never hit a gateway,
 * and a failed commit must not fail the run that already finished.
 *
 * Wired by the editor run host (`brainRunHostPorts.ts` `sessionNote`) through
 * {@link commitRunKnowledge}. The CODE MAP half is the shared `run-knowledge` fact every
 * runtime (on-prem `knowledge-loop.ts`, cloud `runEndMemory.ts`) commits the same way;
 * the model-extracted decisions below are the editor's addition on top of it.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RunKnowledgeLog } from "@builderforce/agent-tools";

/** What a finished run hands its memory commit: the run record's note view and its code map. */
export type FinishedRun = Pick<RunKnowledgeLog, "activity" | "consolidate">;

export type LearnedFactKind = "decision" | "root_cause" | "convention";

export interface LearnedFact {
  key: string;
  content: string;
  kind: LearnedFactKind;
}

export interface MemoryCommitRequest {
  /** What the run was asked, when the caller recorded it. */
  prompt?: string;
  /** Paths the run created or edited. Empty means there is nothing to commit. */
  changed: readonly string[];
  tools?: readonly string[];
  /** Bounded diff or file excerpt. The model extracts from this, not from paths alone. */
  excerpt?: string;
}

export interface MemoryCommitDeps {
  /** One cheap completion. The caller picks the utility route. */
  complete(user: string): Promise<string>;
  /** Write-through project fact. The same key replaces. */
  remember(key: string, content: string): Promise<boolean>;
}

/** A fact shorter than this is noise. Matches the cloud run-memory floor. */
export const MIN_FACT_CHARS = 24;
/** How many facts one run may write. A chatty model must not flood the store. */
const MAX_FACTS = 6;
/** Prefix so these keys are not the ones `workspaceFactsSync` retires. */
const KEY_PREFIX = "learned:";

const KINDS = new Set<LearnedFactKind>(["decision", "root_cause", "convention"]);

export const MEMORY_COMMIT_SYSTEM = [
  "You extract durable project facts from a finished coding run.",
  "Return a JSON array and nothing else. Each item is {key, kind, content}.",
  "kind is one of decision, root_cause, convention.",
  "key is a short kebab-case slug that stays stable if the same fact is learned again.",
  "content is one or two sentences a later run can act on, at least a full sentence.",
  "Only emit a fact the excerpt actually supports. Do not invent, and do not restate the file list.",
  "Return [] when the run learned nothing durable.",
].join(" ");

function changedPaths(input: MemoryCommitRequest): string[] {
  return [...new Set(input.changed.map((p) => p.trim()).filter(Boolean))];
}

/** The user message the utility model sees. Paths alone are not enough to invent from. */
export function memoryCommitPrompt(input: MemoryCommitRequest): string {
  const changed = changedPaths(input);
  const asked = (input.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  const tools = [...new Set((input.tools ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 24);
  const excerpt = (input.excerpt ?? "").trim().slice(0, 6_000);
  return [
    asked ? `Asked: ${asked}` : "",
    `Changed files:\n${changed.map((p) => `- ${p}`).join("\n")}`,
    tools.length ? `Tools: ${tools.join(", ")}` : "",
    excerpt ? `Evidence:\n${excerpt}` : "Evidence: (none recorded — return [] rather than guess)",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function kebab(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function factKey(raw: string): string {
  const body = kebab(raw.replace(/^learned:/i, "").replace(/^workspace:/i, ""));
  return body ? `${KEY_PREFIX}${body}` : "";
}

/**
 * Parse the model's reply into facts worth storing. Prose around a JSON array
 * is ignored; a reply that is not an array, or a fact that is too short, the
 * wrong kind, or keyed like a workspace-sync fact, is dropped.
 */
export function parseLearnedFacts(raw: string): LearnedFact[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: LearnedFact[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (out.length >= MAX_FACTS) break;
    if (!item || typeof item !== "object") continue;
    const row = item as { key?: unknown; kind?: unknown; content?: unknown };
    if (typeof row.kind !== "string" || !KINDS.has(row.kind as LearnedFactKind)) continue;
    if (typeof row.key !== "string" || typeof row.content !== "string") continue;
    if (/^workspace:/i.test(row.key.trim())) continue;
    const key = factKey(row.key);
    const content = row.content.replace(/\s+/g, " ").trim();
    if (!key || content.length < MIN_FACT_CHARS || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, content, kind: row.kind as LearnedFactKind });
  }
  return out;
}

/**
 * Extract and write. Returns the facts that actually landed. Never throws:
 * a memory step must not turn a finished run into a failed one.
 */
export async function commitLearnedFacts(
  input: MemoryCommitRequest,
  deps: MemoryCommitDeps,
): Promise<LearnedFact[]> {
  const changed = changedPaths(input);
  if (changed.length === 0) return [];
  let raw = "";
  try {
    raw = await deps.complete(memoryCommitPrompt({ ...input, changed }));
  } catch {
    return [];
  }
  const facts = parseLearnedFacts(raw);
  const landed: LearnedFact[] = [];
  for (const fact of facts) {
    try {
      if (await deps.remember(fact.key, fact.content)) landed.push(fact);
    } catch {
      /* one bad write must not drop the rest, and must not fail the run */
    }
  }
  return landed;
}

const EXCERPT_FILES = 8;
const EXCERPT_PER_FILE = 800;
const EXCERPT_CHARS = 6_000;

function insideRoot(root: string, rel: string): string | undefined {
  const abs = path.resolve(root, rel);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) return undefined;
  return abs;
}

async function fileHead(root: string, rel: string, budget: number): Promise<string> {
  const abs = insideRoot(root, rel);
  if (!abs) return "";
  try {
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) return "";
    const text = buf.toString("utf8").slice(0, Math.min(EXCERPT_PER_FILE, budget));
    return text.trim() ? `## ${rel}\n${text}` : "";
  } catch {
    return "";
  }
}

/** A bounded `git diff` of the changed paths, or "" when git has nothing to say. */
async function gitDiffExcerpt(root: string, paths: readonly string[]): Promise<string> {
  const safe = paths.filter((p) => insideRoot(root, p)).slice(0, EXCERPT_FILES);
  if (safe.length === 0) return "";
  return new Promise((resolve) => {
    execFile(
      "git",
      ["diff", "--no-color", "--", ...safe],
      { cwd: root, timeout: 8_000, maxBuffer: 64_000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve("");
          return;
        }
        resolve(stdout.slice(0, EXCERPT_CHARS));
      },
    );
  });
}

/**
 * Evidence for the utility model: the diff when git has one, otherwise the
 * head of each changed file. Missing files and binaries contribute nothing.
 */
export async function readChangedExcerpt(root: string, paths: readonly string[]): Promise<string> {
  try {
    const diff = await gitDiffExcerpt(root, paths);
    if (diff.trim()) return diff;
    const parts: string[] = [];
    let budget = EXCERPT_CHARS;
    for (const rel of paths.slice(0, EXCERPT_FILES)) {
      if (budget <= 0) break;
      const head = await fileHead(root, rel, budget);
      if (!head) continue;
      parts.push(head);
      budget -= head.length;
    }
    return parts.join("\n\n").slice(0, EXCERPT_CHARS);
  } catch {
    return "";
  }
}

/**
 * The chat's Memory switch, applied in ONE place: off means the run writes no project
 * facts at all — `deps` (the selected project's facts port, resolved lazily because it
 * needs the editor state) is never even resolved. The workspace's own
 * `.builderforce/memory` note is not project memory and is written regardless.
 */
export async function commitRunKnowledgeIfAllowed(
  root: string,
  run: FinishedRun,
  opts: { memory: boolean },
  resolveDeps: () => Promise<MemoryCommitDeps | undefined>,
): Promise<void> {
  if (!opts.memory) return;
  try {
    const deps = await resolveDeps();
    if (deps) await commitRunKnowledge(root, run, deps);
  } catch {
    /* best-effort: a finished run never fails over its memory */
  }
}

/**
 * Everything a finished editor run leaves in project memory: the code map of what it
 * read and changed (deterministic, every run that touched enough files — a read-only
 * investigation teaches the next run where things live as much as an edit does), then
 * the model-extracted decisions for a run that changed files. Never throws.
 */
export async function commitRunKnowledge(
  root: string,
  run: FinishedRun,
  deps: MemoryCommitDeps,
): Promise<void> {
  const activity = run.activity;
  // The root, so a tool call given an absolute path still maps as a repo file.
  const map = run.consolidate({ root });
  if (map) {
    try {
      await deps.remember(map.key, map.content);
    } catch {
      /* the map is an accelerant; the learned facts below still get their chance */
    }
  }
  const changed = [...(activity.created ?? []), ...(activity.edited ?? [])];
  if (changed.length === 0) return;
  const excerpt = await readChangedExcerpt(root, changed);
  await commitLearnedFacts(
    {
      changed,
      ...(activity.tools ? { tools: activity.tools } : {}),
      excerpt,
      // The same ask the session note summarises — a fact with no task is a guess.
      ...(activity.prompt ? { prompt: activity.prompt } : {}),
    },
    deps,
  );
}
