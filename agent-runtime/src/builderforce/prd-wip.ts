import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logDebug } from "../logger.js";
import { resolvePrdPath } from "./project-dir.js";

const pExecFile = promisify(execFile);

/**
 * The shared PRD "working document" — the single WIP file a task carries across
 * every agent that executes on it.
 *
 * The first agent (architecture-advisor / planning) drafts `PRD.md` at the repo
 * root; downstream agents read it for context and may extend it. When the
 * project is a git repo, the file is staged (`git add`) so it shows up as a
 * pending commit the user can review — we deliberately do NOT auto-commit.
 */

/** Read the current shared PRD, or null if none has been drafted yet. */
export async function readPrdWip(projectRoot: string): Promise<string | null> {
  try {
    return await fs.readFile(resolvePrdPath(projectRoot), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Write/replace the shared PRD working document and stage it as a pending commit
 * when a repo is configured. Best-effort: never throws (PRD authoring must not
 * fail a task), logs at debug on error.
 */
export async function writePrdWip(projectRoot: string, content: string): Promise<void> {
  const file = resolvePrdPath(projectRoot);
  try {
    await fs.writeFile(file, content.endsWith("\n") ? content : `${content}\n`, "utf-8");
  } catch (err) {
    logDebug(`[prd-wip] failed to write PRD: ${String(err)}`);
    return;
  }
  await stageIfRepo(projectRoot, file);
}

/** Stage the PRD file if `projectRoot` is a git working tree; otherwise no-op. */
async function stageIfRepo(projectRoot: string, file: string): Promise<void> {
  try {
    await fs.access(path.join(projectRoot, ".git"));
  } catch {
    return; // not a repo → nothing to stage
  }
  try {
    await pExecFile("git", ["add", "--", file], { cwd: projectRoot });
    logDebug(`[prd-wip] staged ${path.relative(projectRoot, file)} as a pending commit`);
  } catch (err) {
    logDebug(`[prd-wip] git add failed (continuing): ${String(err)}`);
  }
}

/**
 * Heuristic: does this task produce/own the PRD? The planning workflow's first
 * step is an architecture-advisor task whose description asks for a PRD.
 */
export function isPrdTask(agentRole: string, description: string): boolean {
  if (agentRole !== "architecture-advisor") return false;
  return /product requirements document|\bPRD\b/i.test(description);
}
