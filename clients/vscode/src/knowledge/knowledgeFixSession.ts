/**
 * The extension's side of the staged fix flow: apply, undo, preview and check, with what must hold
 * across them.
 *
 *   - Untrusted workspace: apply, undo and check refuse (the preview just reports nothing).
 *   - The first script run for a root (a codemod or a check) asks the person once per session; all
 *     concurrent first runs share ONE pending question.
 *   - Apply, undo and check of one root share one lock; only ONE check runs per root at a time
 *     (a second is refused, not queued), and it can be cancelled or killed with the session.
 *   - Undo is by `fixId` only: the host recorded what the fix wrote (`knowledgeFixUndo.ts`); the
 *     webview names nothing else. An unknown or already used id is refused.
 *
 * Pure over {@link FixSessionHost}, so the bridge supplies VS Code and tests supply fakes.
 */

import { randomUUID } from "node:crypto";
import type { Finding } from "@seanhogg/builderforce-memory/knowledge";
import { sourcePathOf } from "@builderforce/agent-tools/knowledge";
import { PathRefusal } from "./knowledgeFixPaths";
import { applyKnipFix, isFixableKind, nodeFixPorts, serialized, type FixPorts } from "./knowledgeFixes";
import { execCheck, resolveCheck } from "./knowledgeFixSteps";
import { fixText } from "./knowledgeFixText";
import { undoSnapshot, UndoPartial, type FixSnapshot } from "./knowledgeFixUndo";
import { previewOf, runKnipReport, stillReported } from "./knowledgeKnipReport";
import type { KnowledgeCheckReply, KnowledgeFixPreview, KnowledgeFixResult } from "./knowledgeProtocol";
import { DETAIL_CAP, ShellFailure } from "./knowledgeShell";

export interface FixSessionHost {
  trusted(): boolean;
  /** The localized refusal for an untrusted workspace. */
  untrustedError(): Error;
  /** Asks the person to allow running the project's scripts for this root (modal). */
  confirmScripts(rootId: string): Promise<boolean>;
  /** The localized refusal for a declined confirmation. */
  declinedError(): Error;
  /** The editor-bound ports of a folder (unsaved buffers, saves) over the node ones. */
  fixPorts(rootPath: string): FixPorts & ReturnType<typeof nodeFixPorts>;
}

interface Recorded { rootId: string; snapshot: FixSnapshot }

/** A refused path in the person's words; anything else is passed on as it is. */
function worded(error: unknown): unknown {
  if (!(error instanceof PathRefusal)) return error;
  return new Error(error.code === "outside" ? fixText.outsideFolder(error.path) : error.code === "link" ? fixText.throughLink(error.path) : fixText.isLink(error.path));
}

/** The finding's files, root-relative. */
const filesOf = (rootId: string, finding: Finding): string[] => finding.nodes.flatMap((ref) => { const p = sourcePathOf(ref, rootId); return p ? [p] : []; });

export class KnowledgeFixSession {
  private readonly records = new Map<string, Recorded>();
  private readonly confirmed = new Set<string>();
  /** One question per root at a time: concurrent first runs await the same answer. */
  private readonly asking = new Map<string, Promise<void>>();
  private readonly checking = new Map<string, AbortController>();
  private readonly previews = new Map<string, KnowledgeFixPreview | null>();

  constructor(private readonly host: FixSessionHost) {}

  private gate(): void {
    if (!this.host.trusted()) throw this.host.untrustedError();
  }

  private allowScripts(rootId: string): Promise<void> {
    if (this.confirmed.has(rootId)) return Promise.resolve();
    let pending = this.asking.get(rootId);
    if (!pending) {
      pending = (async () => {
        if (!(await this.host.confirmScripts(rootId))) throw this.host.declinedError();
        this.confirmed.add(rootId);
      })().finally(() => { this.asking.delete(rootId); });
      this.asking.set(rootId, pending);
    }
    return pending;
  }

  async apply(rootId: string, rootPath: string, finding: Finding): Promise<KnowledgeFixResult> {
    this.gate();
    await this.allowScripts(rootId);
    this.previews.delete(finding.id);
    return applyKnipFix(this.host.fixPorts(rootPath), rootId, finding, (snapshot) => {
      const fixId = randomUUID();
      this.records.set(fixId, { rootId, snapshot });
      return fixId;
    }).catch((error: unknown) => { throw worded(error); });
  }

  /** Reverts a recorded fix. An id is spent when the undo succeeds; a refused undo (diverged files) can be retried after the person sorts it out. */
  async undo(rootId: string, rootPath: string, fixId: string | undefined): Promise<void> {
    this.gate();
    const record = fixId === undefined ? undefined : this.records.get(fixId);
    if (!record || record.rootId !== rootId) throw new Error(fixText.unknownFix());
    await serialized(rootId, async () => {
      if (this.records.get(fixId!) !== record) throw new Error(fixText.unknownFix());
      try {
        await undoSnapshot(this.host.fixPorts(rootPath), record.snapshot);
      } catch (error) {
        // The files are back; only the branch switch failed. The id is spent either way.
        if (error instanceof UndoPartial) this.records.delete(fixId!);
        throw worded(error);
      }
      this.records.delete(fixId!);
    });
  }

  /**
   * What the fix would remove, from knip's own report. Reported only when the person has already
   * allowed scripts for the root (a preview must not raise a modal on its own); otherwise null and
   * the view lists the finding's files.
   */
  async preview(rootId: string, rootPath: string, finding: Finding): Promise<KnowledgeFixPreview | null> {
    if (!this.host.trusted() || !this.confirmed.has(rootId)) return null;
    if (this.previews.has(finding.id)) return this.previews.get(finding.id) ?? null;
    try {
      const report = await runKnipReport(rootPath);
      const preview = { files: previewOf(report, finding.kind, filesOf(rootId, finding)) };
      this.previews.set(finding.id, preview);
      return preview;
    } catch {
      return null;
    }
  }

  /** Runs one check. A second check for the same root while one is running or waiting is refused. */
  async check(rootId: string, rootPath: string, check: string, finding?: Finding): Promise<KnowledgeCheckReply> {
    this.gate();
    if (this.checking.has(rootId)) throw new Error(fixText.checkRunning());
    const control = new AbortController();
    this.checking.set(rootId, control);
    try {
      if (check === "rescan") return await this.rescan(rootId, rootPath, finding, control.signal);
      const command = await resolveCheck(rootPath, check);
      if (!command) return { status: "skipped" };
      await this.allowScripts(rootId);
      return await serialized(rootId, () => execCheck(rootPath, command, control.signal));
    } finally {
      this.checking.delete(rootId);
    }
  }

  /** The re-scan: knip's report again, over the changed tree; passes when the finding's files are no longer in it. Kinds without a codemod have nothing to re-scan. */
  private async rescan(rootId: string, rootPath: string, finding: Finding | undefined, signal: AbortSignal): Promise<KnowledgeCheckReply> {
    if (!finding || !isFixableKind(finding.kind)) return { status: "skipped" };
    await this.allowScripts(rootId);
    return serialized(rootId, async () => {
      try {
        const left = stillReported(await runKnipReport(rootPath, signal), finding.kind, filesOf(rootId, finding));
        return left.length === 0 ? { status: "pass" } : { status: "fail", detail: fixText.rescanStill(left.join(", ")).slice(0, DETAIL_CAP) };
      } catch (error) {
        const why = error instanceof ShellFailure ? `${error.message}${error.output ? `\n${error.output}` : ""}` : error instanceof Error ? error.message : String(error);
        return { status: "fail", detail: why.slice(-DETAIL_CAP) };
      }
    });
  }

  /** Stops the running check of a root (and its whole process tree). */
  cancel(rootId: string): void {
    this.checking.get(rootId)?.abort();
  }

  dispose(): void {
    for (const control of this.checking.values()) control.abort();
    this.checking.clear();
  }
}
