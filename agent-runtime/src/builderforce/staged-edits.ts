/**
 * Staged edit buffer — pair-programming mode for BuilderForce Agents.
 *
 * When staging is active (`BUILDERFORCE_AGENTS_STAGED=true` or `/stage on`),
 * agent file edits are held in memory instead of being written immediately.
 * The TUI uses /diff, /accept, and /reject to review and apply or discard changes.
 */

import fs from "node:fs";
import path from "node:path";

export type StagedEdit = {
  filePath: string;
  originalContent: string | null;
  proposedContent: string;
  isNew: boolean;
  toolCallId: string;
  label?: string;
  stagedAt: number;
};

const _store = new Map<string, StagedEdit>();
let _stagingActive = false;

const MAX_DIFF_LINES = 1200;
const CONTEXT = 3;

export function isStagingActive(): boolean {
  return _stagingActive || process.env.BUILDERFORCE_AGENTS_STAGED === "true";
}

export function activateStaging(): void {
  _stagingActive = true;
}

export function deactivateStaging(): void {
  _stagingActive = false;
}

export function clearAllStagedEdits(): void {
  _store.clear();
}

/** Test helper: drop the in-memory flag and buffer. Does not unset the env var. */
export function resetStagingForTests(): void {
  _stagingActive = false;
  _store.clear();
}

export function getStagedEdits(): StagedEdit[] {
  return [..._store.values()];
}

export function getStagedEdit(filePath: string): StagedEdit | undefined {
  return _store.get(path.resolve(filePath));
}

/**
 * Resolve a user-typed path against the buffer: exact resolve, then unique
 * suffix / basename match (so `/accept src/Foo.ts` works on Windows/mixed case).
 */
export function resolveStagedTarget(input: string): StagedEdit | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const exact = getStagedEdit(trimmed);
  if (exact) return exact;
  const needle = trimmed.replace(/\\/g, "/").toLowerCase();
  const edits = getStagedEdits();
  const bySuffix = edits.filter((e) =>
    e.filePath.replace(/\\/g, "/").toLowerCase().endsWith(needle),
  );
  if (bySuffix.length === 1) return bySuffix[0];
  const base = path.basename(trimmed).toLowerCase();
  const byBase = edits.filter((e) => path.basename(e.filePath).toLowerCase() === base);
  if (byBase.length === 1) return byBase[0];
  return undefined;
}

export function hasStagedEdits(): boolean {
  return _store.size > 0;
}

export function stageEdit(opts: {
  filePath: string;
  proposedContent: string;
  toolCallId: string;
  label?: string;
}): { staged: boolean; message: string } {
  const abs = path.resolve(opts.filePath);
  let original: string | null = null;
  let isNew = false;
  const existing = _store.get(abs);
  if (existing) {
    // Accumulate against the first disk snapshot so sequential edits stay one hunk.
    original = existing.originalContent;
    isNew = existing.isNew;
  } else {
    try {
      original = fs.readFileSync(abs, "utf-8");
    } catch {
      isNew = true;
    }
  }
  _store.set(abs, {
    filePath: abs,
    originalContent: original,
    proposedContent: opts.proposedContent,
    isNew,
    toolCallId: opts.toolCallId,
    label: opts.label,
    stagedAt: Date.now(),
  });
  return {
    staged: true,
    message: isNew
      ? `Staged new file: ${abs}. Run /accept to apply or /reject to discard.`
      : `Staged edit to ${abs}. Run /diff to review, /accept to apply, or /reject to discard.`,
  };
}

export async function acceptEdit(
  filePath: string,
): Promise<{ accepted: boolean; filePath: string; error?: string }> {
  const resolved = resolveStagedTarget(filePath) ?? getStagedEdit(filePath);
  if (!resolved) {
    return { accepted: false, filePath, error: `No staged edit for ${filePath}` };
  }
  const abs = resolved.filePath;
  try {
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, resolved.proposedContent, "utf-8");
    _store.delete(abs);
    return { accepted: true, filePath: abs };
  } catch (err) {
    return {
      accepted: false,
      filePath: abs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function acceptAllEdits(): Promise<{
  accepted: string[];
  failed: Array<{ filePath: string; error: string }>;
}> {
  const accepted: string[] = [];
  const failed: Array<{ filePath: string; error: string }> = [];
  // Snapshot keys so deleting during accept cannot skip entries.
  const keys = [..._store.keys()];
  for (const key of keys) {
    const result = await acceptEdit(key);
    if (result.accepted) {
      accepted.push(result.filePath);
    } else {
      failed.push({ filePath: result.filePath, error: result.error ?? "unknown" });
    }
  }
  return { accepted, failed };
}

export function rejectEdit(filePath: string): { rejected: boolean; filePath: string } {
  const resolved = resolveStagedTarget(filePath) ?? getStagedEdit(filePath);
  if (!resolved) {
    return { rejected: false, filePath };
  }
  _store.delete(resolved.filePath);
  return { rejected: true, filePath: resolved.filePath };
}

export function rejectAllEdits(): { rejected: string[] } {
  const rejected = [..._store.keys()];
  _store.clear();
  return { rejected };
}

type DiffLine = { tag: " " | "-" | "+"; text: string };

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ tag: " ", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ tag: "-", text: a[i] });
      i++;
    } else {
      out.push({ tag: "+", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ tag: "-", text: a[i] });
    i++;
  }
  while (j < m) {
    out.push({ tag: "+", text: b[j] });
    j++;
  }
  return out;
}

function collapseContext(lines: DiffLine[]): string[] {
  const changedAt = lines.map((l) => l.tag !== " ");
  const keep = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (changedAt[i]) {
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) {
        keep[k] = true;
      }
    }
  }
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (keep[i]) {
      out.push(lines[i].tag + lines[i].text);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && !keep[j]) j++;
    out.push(`@@ … ${j - i} unchanged line${j - i === 1 ? "" : "s"} … @@`);
    i = j;
  }
  return out;
}

export function buildUnifiedDiff(edit: StagedEdit): string {
  const header = [`--- a/${edit.filePath}`, `+++ b/${edit.filePath}`];
  if (edit.isNew || edit.originalContent == null) {
    const body = edit.proposedContent.split("\n").map((l) => `+${l}`);
    return [...header, `@@ -0,0 +1,${body.length} @@`, ...body].join("\n");
  }
  const a = edit.originalContent.split("\n");
  const b = edit.proposedContent.split("\n");
  if (a.length + b.length > MAX_DIFF_LINES) {
    return [
      ...header,
      `@@ -1,${a.length} +1,${b.length} @@`,
      "(file too large for an inline diff — showing proposed content)",
      ...b.map((l) => `+${l}`),
    ].join("\n");
  }
  const body = collapseContext(lcsDiff(a, b));
  return [...header, `@@ -1,${a.length} +1,${b.length} @@`, ...body].join("\n");
}

export function buildStagedSummary(): string {
  const edits = getStagedEdits();
  if (edits.length === 0) {
    return "No staged changes.";
  }
  const lines = [`${edits.length} staged change(s):`, ""];
  for (const e of edits) {
    const kind = e.isNew ? "new" : "edit";
    const label = e.label ? ` [${e.label}]` : "";
    lines.push(`  ${kind}${label}: ${e.filePath}`);
  }
  lines.push("");
  lines.push("Run /diff to review, /accept to apply all, /reject to discard all.");
  lines.push("Run /diff <file>, /accept <file>, or /reject <file> for a single file.");
  return lines.join("\n");
}
