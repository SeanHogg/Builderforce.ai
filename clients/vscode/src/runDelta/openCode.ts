/**
 * "Open code" from a run-delta card, CONFINED (PRD 41 §C11): the webview names a stored run and a path in it —
 * `run-delta/open { runId, path }` (path repo-relative) — and the HOST resolves the file. The path must be one the stored delta
 * itself names (a changed, renamed, dependent, entry-point, excluded or evidence path), relative, with no `..` segment, and it
 * must resolve under that delta's repository root — textually ({@link confinedPath}) AND on disk: both the root and the file are
 * resolved through their symlinks (`fs.realpath`) before the containment check ({@link realFileUnder}), and a file that does
 * not exist is refused. Anything else is refused: a card can never open a file outside its repo, whatever the webview sends.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LocalFirstStore } from "@builderforce/local-first";
import type { RunDelta } from "@builderforce/run-delta";
import { readRunDeltas } from "./runDeltaRecords";

export interface OpenCodeRequest {
  runId: string;
  /** Repository-relative POSIX path, as the card shows it. */
  path: string;
}

/** Every path a stored delta names. */
export function deltaPaths(delta: RunDelta): Set<string> {
  const out = new Set<string>([
    ...delta.impact.changedFiles, ...delta.impact.dependents, ...delta.impact.entryPoints,
    ...delta.impact.renamed.flatMap((r) => [r.from, r.to]),
    ...delta.excluded.map((e) => e.path),
  ]);
  for (const d of delta.dimensions) for (const f of d.findings) for (const e of f.evidence) out.add(e.path);
  return out;
}

/** Whether `rel` (a `path.relative` answer) names something strictly inside its base. */
const isInside = (rel: string): boolean => !!rel && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);

/** The absolute file a request may open under `root`, or undefined when it is refused. Pure. */
export function confinedPath(root: string, delta: RunDelta, requested: string): string | undefined {
  if (typeof requested !== "string" || !requested || requested.includes("\0")) return undefined;
  const rel = requested.replace(/\\/g, "/");
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split("/").some((part) => part === "..")) return undefined;
  if (!deltaPaths(delta).has(rel)) return undefined;
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  return isInside(path.relative(base, abs)) ? abs : undefined;
}

/**
 * `file` resolved through every symlink, when it exists and still lies under `root` resolved the same way; undefined
 * otherwise (a link inside the repository that points outside it, a missing file, an unreadable root).
 */
export async function realFileUnder(root: string, file: string): Promise<string | undefined> {
  try {
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
    return isInside(path.relative(realRoot, realFile)) ? realFile : undefined;
  } catch {
    return undefined;
  }
}

/** The absolute file for a card's Open code request, from the stored delta; undefined when refused or unknown. */
export async function runDeltaFile(store: LocalFirstStore, request: OpenCodeRequest): Promise<string | undefined> {
  if (typeof request.runId !== "string") return undefined;
  // A run can cover several repositories: the first of its deltas that names the path opens it.
  for (const card of await readRunDeltas(store, { runId: request.runId })) {
    const file = confinedPath(card.root, card.delta, request.path);
    const real = file ? await realFileUnder(card.root, file) : undefined;
    if (real) return real;
  }
  return undefined;
}
