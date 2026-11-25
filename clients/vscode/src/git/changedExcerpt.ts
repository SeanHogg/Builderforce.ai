/**
 * The evidence the run-end memory commit shows its utility model: a bounded `git diff` of the paths the run changed, else the head of
 * each changed file.
 *
 * This is the one part of the memory commit that is the EDITOR's own: it reads the workspace with node `fs` and spawns `git`, and the
 * agent (`@builderforce/agent-run`, which runs in the Worker and the browser too) may import neither. Everything else - the code map,
 * the learned-facts extraction and its parser, the Memory switch - is the agent's, once (`@builderforce/agent-run/memory`); the editor
 * hands this to it as `MemoryCommitDeps.excerpt` (`editorRunEnd.ts`).
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

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
