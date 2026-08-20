import * as vscode from "vscode";
import * as path from "path";
import { canManageActiveWorkspace, getTenantJwt } from "./bfApi";
import { getBaseUrl, SECRET_KEY } from "./gateway";
import { getSelectedProject } from "./projectState";
import { renderWebviewHtml } from "./webviewShared";
import { compactMemoryFiles, compactionTargets, readMemorySource, type CompactRequest } from "./memoryImport";

/**
 * The Evermind sidebar view — a bundled-React webview view that renders the SHARED
 * <EvermindConsole> (the same inspect-and-train surface the web app embeds), so a
 * user can inspect what their project's self-learning model has learned and steer
 * its training right in the editor. See [[evermind-learning-architecture]].
 *
 * Unlike the Brain chat (an editor PANEL), this lives IN the activity-bar sidebar
 * beside Sessions / Project & Tasks / Inbox / Insights. The React app reaches the
 * gateway directly over the webview's bearer fetch (CORS allows the
 * `vscode-webview://` origin); the host's only jobs are minting the tenant token,
 * resolving the manager gate, and scoping to the active project (re-pushing `init`
 * on a project switch — the same contract the Brain panel uses).
 */
export class EvermindViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "builderforce.evermind";
  private view: vscode.WebviewView | undefined;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    view.webview.html = renderWebviewHtml(view.webview, this.ctx, { title: "Project Evermind" });
    view.webview.onDidReceiveMessage((m) => void this.onMessage(m as { type?: string; id?: string }));
    // Re-pull when the view regains visibility (a token may have refreshed while hidden).
    view.onDidChangeVisibility(() => { if (view.visible) void this.sendInit(); });
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; });
  }

  /** Re-push init (token / project / manager gate) to the live view — on project
   *  switch and sign-in/out, mirroring BrainWebview.refresh. No-op when not resolved. */
  refresh(): void {
    void this.sendInit();
  }

  /** Ask the live view to reload its data in place — driven by the view's title-bar
   *  refresh action (the relocated inline `↻`). No-op when the view isn't resolved. */
  triggerRefresh(): void {
    void this.view?.webview.postMessage({ type: "refresh" });
  }

  private async onMessage(msg: { type?: string; id?: string; version?: number; text?: string } & CompactRequest): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendInit();
        break;
      case "token.refresh": {
        const token = (await getTenantJwt(this.ctx.secrets)) ?? null;
        this.respond(msg.id, true, { token });
        break;
      }
      case "signin":
        void vscode.commands.executeCommand("builderforce.signIn");
        break;
      // Import step 1 — let the user pick a memory SOURCE (a builderforce-memory JSON
      // snapshot or a Claude Code auto-memory folder); read + parse it and hand the
      // webview the learnable entries, each tagged with the file it came from
      // (already-stubbed ones are excluded so re-import is idempotent). The FILE touch
      // lives here because only the host has fs.
      case "evermind.pickMemory":
        await this.pickMemory(msg.id);
        break;
      // Import step 3 — after the gateway absorbed the entries, rewrite THOSE to terse
      // stubs in place (preserving every other field), recovering the context they ate.
      // The request carries one group PER SOURCE FILE, because a markdown memory
      // directory holds each absorbed fact in its own file.
      case "evermind.compactMemory":
        await this.compactMemory(msg.id, msg, msg.version);
        break;
      // Diagnostics export. The clipboard write happens on the HOST because a webview is
      // not reliably granted the Clipboard API — `vscode.env.clipboard` always works,
      // and a copy button that silently fails is worse than none (the operator walks
      // away believing they have the report).
      case "evermind.copyText":
        await this.copyText(msg.id, msg.text);
        break;
    }
  }

  /** Put the diagnostics report on the system clipboard and confirm it in the editor. */
  private async copyText(id: string | undefined, text?: string): Promise<void> {
    try {
      if (!text) { this.respond(id, false, undefined, "nothing to copy"); return; }
      await vscode.env.clipboard.writeText(text);
      // A toast as well as the in-panel confirmation: the sidebar is narrow and the
      // status line can sit below the fold.
      void vscode.window.setStatusBarMessage(vscode.l10n.t("Evermind diagnostics copied to the clipboard."), 4000);
      this.respond(id, true, null);
    } catch (e) {
      this.respond(id, false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  /** Open a memory source, parse it, and return `{ path, fileName, entries:[{key,text,prompt?,path}] }`
   *  — or `null` (a plain no-op) when the user cancels the picker. Each entry carries its OWN
   *  source path: a JSON snapshot yields one shared path, a Claude Code memory directory yields
   *  one path per fact, and everything downstream is written against that single shape. */
  private async pickMemory(id: string | undefined): Promise<void> {
    try {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        // A Claude Code auto-memory is a FOLDER. Where the platform's native dialog
        // cannot offer files and folders at once, its `MEMORY.md` index is the
        // file-shaped way in — `readMemorySource` accepts either.
        canSelectFolders: true,
        openLabel: vscode.l10n.t("Import"),
        title: vscode.l10n.t("Import agent memory (JSON snapshot or memory folder)"),
        filters: {
          [vscode.l10n.t("Agent memory (snapshot or MEMORY.md)")]: ["json", "md"],
          [vscode.l10n.t("All files")]: ["*"],
        },
      });
      const uri = picked?.[0];
      if (!uri) { this.respond(id, true, null); return; }
      const entries = await readMemorySource(uri.fsPath);
      if (!entries) {
        this.respond(id, false, undefined, vscode.l10n.t("Unrecognized file — expected a builderforce-memory JSON snapshot (an array of {{ key, content }} entries), or a Claude Code memory folder of *.md facts."));
        return;
      }
      this.respond(id, true, { path: uri.fsPath, fileName: path.basename(uri.fsPath), entries });
    } catch (e) {
      this.respond(id, false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  /** Rewrite each absorbed entry's body to a `[absorbed→Evermind vN] …` stub, in place,
   *  preserving all other fields — across EVERY source file the import touched.
   *  Returns `{ compacted, bytesSaved }`. */
  private async compactMemory(id: string | undefined, req: CompactRequest, version?: number): Promise<void> {
    try {
      // No targets is not an error — the gateway absorbed nothing, so there is nothing
      // to stub. The import reports "compacted 0" exactly as it did before.
      const outcome = await compactMemoryFiles(compactionTargets(req), typeof version === "number" ? version : 0);
      if (!outcome.ok) { this.respond(id, false, undefined, vscode.l10n.t("Could not re-read the memory file to compact it.")); return; }
      this.respond(id, true, { compacted: outcome.compacted, bytesSaved: outcome.bytesSaved });
    } catch (e) {
      this.respond(id, false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  private respond(id: string | undefined, ok: boolean, result?: unknown, error?: string): void {
    if (!id || !this.view) return;
    void this.view.webview.postMessage({ type: "response", id, ok, result, ...(error ? { error } : {}) });
  }

  /** Hand the React app its config: gateway URL, tenant token, active project, the
   *  manager gate, and the localized label bundle — with `view:'evermind'` so the
   *  shared bundle renders the Evermind console. */
  private async sendInit(): Promise<void> {
    if (!this.view) return;
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    const token = signedIn ? ((await getTenantJwt(this.ctx.secrets)) ?? null) : null;
    const canManage = signedIn ? await canManageActiveWorkspace(this.ctx.secrets) : false;
    void this.view.webview.postMessage({
      type: "init",
      view: "evermind",
      baseUrl: getBaseUrl(),
      token,
      signedIn,
      hasWorkspace: !!vscode.workspace.workspaceFolders?.[0],
      project: getSelectedProject(),
      canManage,
      tools: [],
      labels: buildEvermindLabels(),
    });
  }
}

/**
 * The localized label bundle for the Evermind console. The bundled webview ships no
 * i18n stack of its own (next-intl is web-only), so the host translates here via
 * `vscode.l10n` (editor display language) and forwards the `ev.*` bundle through
 * `init`, exactly as the Brain panel does for its own strings.
 */
function buildEvermindLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "ev.title": t("Project Evermind"),
    "ev.description": t("The self-learning model for this project. It adapts as this project’s agents run — inspect what it has learned and steer its training below."),
    // Build picker — a Project can group many LLM builds; each is its own Evermind.
    "ev.buildLabel": t("Model"),
    "ev.loadingBuilds": t("Loading models…"),
    "ev.noBuilds": t("No LLM models yet. Create one in the LLM Studio, then it will appear here."),
    "ev.ungrouped": t("Ungrouped"),
    "ev.loading": t("Loading…"),
    "ev.managerOnlyHint": t("Only a project manager can change these settings."),
    "ev.statusSeeded": t("Learning · v{version}"),
    "ev.statusUnseeded": t("Not set up"),
    // Quarantine (auto-disabled after incoherent serves)
    "ev.quarantinedBadge": t("Quarantined"),
    "ev.quarantinedHint": t("This Evermind auto-disabled after producing incoherent output ({reason}). Retrain it past the coherence bar to re-enable inference."),
    // Targets ("Everminds under this project")
    "ev.targetsTitle": t("Everminds under this project"),
    "ev.targetsHint": t("Every Evermind this project contributes learning to."),
    "ev.targetsEmpty": t("No Everminds resolved for this project yet."),
    "ev.targetSelfBadge": t("This project"),
    "ev.targetBuildBadge": t("IDE build"),
    "ev.targetSeeded": t("v{version}"),
    "ev.targetUnseeded": t("not seeded"),
    "ev.targetInferenceOn": t("inference"),
    "ev.targetConnected": t("connected"),
    "ev.targetFrozen": t("frozen"),
    "ev.targetProjectId": t("project #{id}"),
    "ev.pickModelLabel": t("Base model"),
    "ev.noModels": t("No published Evermind models to start from yet. Train and publish one in Studio first."),
    "ev.notSetUp": t("This project’s Evermind isn’t set up yet. A project manager can enable it."),
    "ev.noProject": t("Select a project in the sidebar to inspect its Evermind."),
    "ev.enableCta": t("Enable"),
    "ev.working": t("Working…"),
    "ev.versionLabel": t("Version"),
    "ev.contributionsLabel": t("Learned"),
    "ev.pendingLabel": t("Queued"),
    "ev.lastLearnedLabel": t("Last learned"),
    "ev.neverLearned": t("Never"),
    "ev.inferenceLabel": t("Run on Evermind"),
    "ev.inferenceHint": t("When on, this project’s agent runs execute on its own learned model."),
    "ev.learningLabel": t("Learning"),
    "ev.learningHint": t("When connected, runs contribute what they learn back into the model."),
    "ev.on": t("On"),
    "ev.off": t("Off"),
    "ev.connected": t("Connected"),
    "ev.frozen": t("Frozen"),
    "ev.teacherLabel": t("Teacher model"),
    "ev.teacherHint": t("Distil each run through a frontier model (task → ideal answer) instead of raw run text."),
    "ev.teacherNone": t("None (learn from raw runs)"),
    "ev.teacherPaidOnly": t("A teacher model is available on paid plans."),
    "ev.teachTitle": t("Teach from a transcript"),
    "ev.teachHint": t("Paste a chat transcript or exemplar to contribute it to the model now."),
    "ev.teachPromptPlaceholder": t("Task this answered (optional)…"),
    "ev.teachTextPlaceholder": t("Paste the transcript or exemplar text…"),
    "ev.teachCta": t("Teach"),
    "ev.teaching": t("Teaching…"),
    "ev.taught": t("Queued for learning."),
    // Resolved teach outcomes — the console polls the per-contribution status door and
    // replaces the interim "Queued" notice above with one of these.
    "ev.taughtDistilled": t("Taught: {model} answered it and the model learned that answer (v{version})."),
    "ev.taughtSelf": t("Taught: learned from your text, with no teacher model (v{version})."),
    "ev.taughtTeacherFault": t("Learned, but the teacher {model} produced nothing ({reason}) — so the model learned your raw text, not an ideal answer."),
    "ev.taughtDropped": t("Not learned: the merge could not use this contribution."),
    "ev.taughtStillPending": t("Still queued — this will merge on the next learning pass."),
    "ev.flushCta": t("Learn now"),
    "ev.flushing": t("Learning…"),
    "ev.flushedNone": t("Nothing queued to learn yet."),
    "ev.flushedN": t("Merged {merged} contribution(s) into v{version}."),
    // Import from builderforce-memory (editor-only — the host has filesystem access).
    "ev.importTitle": t("Import from builderforce-memory"),
    "ev.importHint": t("Fold a local memory snapshot or Claude Code memory folder into this model, then compact the absorbed facts to stubs so they stop filling your context."),
    "ev.importCta": t("Import & compact…"),
    "ev.importing": t("Importing…"),
    "ev.importDone": t("Absorbed {absorbed} memory(ies) into v{version}; compacted {compacted} to stubs (~{savedKb} KB recovered)."),
    "ev.importNothing": t("Nothing to import — no learnable facts in that file."),
    "ev.inspectTitle": t("Recently learned"),
    "ev.inspectEmpty": t("Nothing learned yet. Runs and teaching will appear here."),
    "ev.kindText": t("Run"),
    "ev.kindDelta": t("Delta"),
    "ev.deltaEntry": t("Weight delta contributed by an agent run."),
    // Test bench — generate from the model and grade it, so "what will this produce?"
    // is answerable in the editor before anyone chats with it.
    "ev.testTitle": t("Test bench"),
    "ev.testHint": t("Run a prompt through the model and see exactly what it writes, graded the same way a real reply is. This is how you check the model is worth switching on — before anyone chats with it."),
    "ev.testPlaceholder": t("Ask the model something, e.g. “Summarise where this project stands.”"),
    "ev.testRunCta": t("Run prompt"),
    "ev.testReadinessCta": t("Readiness check"),
    "ev.testRunning": t("Generating…"),
    "ev.testResultPrompt": t("What the model produced"),
    "ev.testServable": t("Usable"),
    "ev.testRefused": t("Refused"),
    "ev.testEmptyOutput": t("(the model produced nothing)"),
    "ev.testVerdictReady": t("This model is coherent enough to serve replies."),
    "ev.testVerdictNotReady": t("This model is not coherent enough to serve replies yet. Teach it more, set a teacher model, or re-seed it below."),
    // Maintenance — replace / rebuild index / clean up.
    "ev.maintenanceTitle": t("Maintenance"),
    "ev.maintenanceHint": t("Repair and tidy the model when it has gone wrong. None of this deletes your project’s work."),
    "ev.reseedLabel": t("Replace the model"),
    "ev.reseedHint": t("Start over from a known-good base, keeping the project. Use this when the model has trained itself into nonsense. Replies stay switched off until it passes a readiness check again."),
    "ev.reseedCta": t("Replace…"),
    "ev.reseedConfirm": t("Replace this model’s brain with a fresh base? What it has learned so far will no longer shape its answers. This cannot be undone."),
    "ev.reseedStarterOption": t("Fresh starter base (untrained)"),
    "ev.reindexLabel": t("Rebuild recall index"),
    "ev.reindexHint": t("Re-file every memory against the current model. Memories are filed when they are learned, so recall drifts as the model changes — rebuild if it starts recalling the wrong things."),
    "ev.reindexCta": t("Rebuild index"),
    "ev.cleanupLabel": t("Clean up"),
    "ev.cleanupHint": t("Throw away anything queued but not yet learned, and clear cached answers so repeat questions are answered fresh. Learned knowledge is untouched."),
    "ev.cleanupCta": t("Clean up"),
    "ev.cleanupConfirm": t("Discard everything queued but not yet learned, and clear cached answers?"),
    // Knowledge analyzer — audit what was learned, then repair it.
    "ev.analyzeTitle": t("Check what it has learned"),
    "ev.analyzeHint": t("Read back everything the model has learned and have a frontier model check it for mistakes, stale facts and nonsense — then fix what is wrong by teaching the corrections."),
    "ev.analyzeCta": t("Check knowledge"),
    "ev.analyzing": t("Checking…"),
    "ev.analyzeCorrectionLabel": t("Will be replaced with"),
    "ev.analyzeSelectAll": t("Select all"),
    "ev.analyzeSelectNone": t("Clear selection"),
    "ev.analyzeApplying": t("Fixing…"),
    // Tabs — the console's four working surfaces.
    "ev.tabsLabel": t("Evermind controls"),
    "ev.tabTeach": t("Teach"),
    "ev.tabTest": t("Test"),
    "ev.tabCheck": t("Check"),
    "ev.tabMaintain": t("Maintain"),
    // Diagnostics export. The report BODY is a technical artifact and is deliberately
    // not localized (see diagnosticsReport.ts); only these controls are.
    "ev.diagnosticsTitle": t("Diagnostics"),
    "ev.diagnosticsHint": t("Copy everything on this panel — the model’s state, what it actually produced, what it has learned and any problems found — as text you can paste to support or to an AI assistant."),
    "ev.diagnosticsCta": t("Copy diagnostics"),
    "ev.diagnosticsCopied": t("Copied to your clipboard."),
    "ev.diagnosticsShow": t("Show report"),
    "ev.diagnosticsHide": t("Hide report"),
    "ev.diagnosticsManualHint": t("Copying automatically was blocked here — the report is selected below, press Ctrl/Cmd+C to copy it."),
    "ev.refresh": t("Refresh"),
    "ev.errorGeneric": t("Something went wrong. Try again."),
  };
}
