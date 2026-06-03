/**
 * Staged edits — per-session buffer for reviewing agent file changes before they land.
 *
 * When BUILDERFORCE_AGENTS_STAGED=true (or staged mode is activated via /diff), the edit/create
 * tools write proposed changes here instead of directly to disk. The developer then
 * uses /diff, /accept, and /reject to review and apply or discard changes.
 *
 * This is the same UX as Cursor Composer's accept/reject panel and Aider's diff mode.
 */

import fs from "node:fs/promises";
import path from "node:path";

export type StagedEdit = {
  /** Absolute path of the file */
  filePath: string;
  /** Content before the change (null if the file is new) */
  originalContent: string | null;
  /** Proposed content after the change */
  proposedContent: string;
  /** Whether this is a new file creation */
  isNew: boolean;
  /** Tool call ID that produced this change */
  toolCallId: string;
  /** Human-readable label for the change */
  label: string;
  /** ISO timestamp when staged */
  stagedAt: string;
};

/** In-memory staged edits store. Keyed by absolute file path. */
const _store = new Map<string, StagedEdit>();

/** Whether staged mode is active. Can be toggled via config or /diff command. */
let _stagingActive = false;

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

export function getStagedEdits(): StagedEdit[] {
  return Array.from(_store.values());
}

export function getStagedEdit(filePath: string): StagedEdit | undefined {
  return _store.get(path.resolve(filePath));
}

export function hasStagedEdits(): boolean {
  return _store.size > 0;
}

/**
 * Stage a proposed edit. Reads the original content from disk if the file exists.
 * Returns a confirmation message to return to the agent.
 */
export async function stageEdit(params: {
  filePath: string;
  proposedContent: string;
  toolCallId: string;
  label?: string;
}): Promise<{ staged: true; filePath: string; message: string }> {
  const abs = path.resolve(params.filePath);
  let originalContent: string | null = null;
  let isNew = false;

  try {
    originalContent = await fs.readFile(abs, "utf-8");
  } catch {
    isNew = true;
  }

  const edit: StagedEdit = {
    filePath: abs,
    originalContent,
    proposedContent: params.proposedContent,
    isNew,
    toolCallId: params.toolCallId,
    label: params.label ?? path.basename(abs),
    stagedAt: new Date().toISOString(),
  };

  _store.set(abs, edit);

  return {
    staged: true,
    filePath: abs,
    message: isNew
      ? `Staged new file: ${abs}. Run /accept to apply or /reject to discard.`
      : `Staged edit to ${abs}. Run /diff to review, /accept to apply, or /reject to discard.`,
  };
}

/**
 * Apply a staged edit to disk (accept).
 * Returns the file path on success.
 */
export async function acceptEdit(
  filePath: string,
): Promise<{ accepted: boolean; filePath: string; error?: string }> {
  const abs = path.resolve(filePath);
  const edit = _store.get(abs);
  if (!edit) {
    return { accepted: false, filePath: abs, error: "No staged edit found for this file." };
  }

  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, edit.proposedContent, "utf-8");
    _store.delete(abs);
    return { accepted: true, filePath: abs };
  } catch (err) {
    return {
      accepted: false,
      filePath: abs,
      error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Accept all staged edits.
 */
export async function acceptAllEdits(): Promise<{
  accepted: string[];
  failed: Array<{ filePath: string; error: string }>;
}> {
  const accepted: string[] = [];
  const failed: Array<{ filePath: string; error: string }> = [];

  for (const edit of _store.values()) {
    const result = await acceptEdit(edit.filePath);
    if (result.accepted) {
      accepted.push(result.filePath);
    } else {
      failed.push({ filePath: result.filePath, error: result.error ?? "unknown error" });
    }
  }

  return { accepted, failed };
}

/**
 * Discard a staged edit without applying it (reject).
 */
export function rejectEdit(filePath: string): {
  rejected: boolean;
  filePath: string;
  error?: string;
} {
  const abs = path.resolve(filePath);
  if (!_store.has(abs)) {
    return { rejected: false, filePath: abs, error: "No staged edit found for this file." };
  }
  _store.delete(abs);
  return { rejected: true, filePath: abs };
}

/**
 * Discard all staged edits.
 */
export function rejectAllEdits(): { rejected: string[] } {
  const rejected = Array.from(_store.keys());
  _store.clear();
  return { rejected };
}

/**
 * Produce a unified diff string for a staged edit.
 * Uses a simple line-diff algorithm (no external diff binary required).
 */
export function buildUnifiedDiff(edit: StagedEdit): string {
  const from = edit.originalContent ?? "";
  const to = edit.proposedContent;
  const relPath = edit.filePath;

  if (from === to) {
    return `--- ${relPath}\n+++ ${relPath}\n(no changes)\n`;
  }

  const fromLines = from.split("\n");
  const toLines = to.split("\n");

  const header = edit.isNew
    ? `--- /dev/null\n+++ ${relPath}\n`
    : `--- ${relPath} (original)\n+++ ${relPath} (proposed)\n`;

  // Simple unified diff: show all lines as one hunk for clarity
  const changes: string[] = [];

  for (const line of fromLines) {
    changes.push(`-${line}`);
  }
  for (const line of toLines) {
    changes.push(`+${line}`);
  }

  return `${header}@@ -1,${fromLines.length} +1,${toLines.length} @@\n${changes.join("\n")}\n`;
}

/**
 * Build a human-readable summary of all staged edits for display in the TUI.
 */
export function buildStagedSummary(): string {
  const edits = getStagedEdits();
  if (edits.length === 0) {
    return "No staged changes.";
  }

  const lines = [`${edits.length} staged change${edits.length === 1 ? "" : "s"}:`, ""];
  for (const edit of edits) {
    const tag = edit.isNew ? " [new]" : " [edit]";
    lines.push(`  ${edit.filePath}${tag}`);
  }
  lines.push("");
  lines.push("Run /diff to review, /accept to apply all, /reject to discard all.");
  lines.push("Run /diff <file>, /accept <file>, or /reject <file> for a single file.");
  return lines.join("\n");
}
