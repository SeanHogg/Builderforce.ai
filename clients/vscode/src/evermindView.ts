import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { canManageActiveWorkspace, getTenantJwt } from "./bfApi";
import { getBaseUrl, SECRET_KEY } from "./gateway";
import { getSelectedProject } from "./projectState";
import { renderWebviewHtml } from "./webviewShared";
import { parseSnapshotArray, snapshotEntryKey, snapshotEntryContent, setSnapshotEntryContent, memoryStub, isStub } from "./memorySnapshot";

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

  private async onMessage(msg: { type?: string; id?: string; path?: string; absorbedKeys?: string[]; version?: number }): Promise<void> {
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
      // Import step 1 — let the user pick a builderforce-memory snapshot; read + parse it
      // and hand the webview the learnable entries (already-stubbed ones are excluded so
      // re-import is idempotent). The FILE touch lives here because only the host has fs.
      case "evermind.pickMemory":
        await this.pickMemory(msg.id);
        break;
      // Import step 3 — after the gateway absorbed the entries, rewrite THOSE to terse
      // stubs in place (preserving every other field), recovering the context they ate.
      case "evermind.compactMemory":
        await this.compactMemory(msg.id, msg.path, msg.absorbedKeys, msg.version);
        break;
    }
  }

  /** Open a snapshot, parse it, and return `{ path, fileName, entries:[{key,text}] }` —
   *  or `null` (a plain no-op) when the user cancels the picker. */
  private async pickMemory(id: string | undefined): Promise<void> {
    try {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: vscode.l10n.t("Import"),
        title: vscode.l10n.t("Import builderforce-memory snapshot"),
        filters: { "builderforce-memory (JSON)": ["json"], "All files": ["*"] },
      });
      const uri = picked?.[0];
      if (!uri) { this.respond(id, true, null); return; }
      const text = await fs.readFile(uri.fsPath, "utf8");
      const entries = parseSnapshotArray(text);
      if (!entries) {
        this.respond(id, false, undefined, vscode.l10n.t("Unrecognized file — expected a builderforce-memory JSON snapshot (an array of {{ key, content }} entries)."));
        return;
      }
      const wire = entries
        .map((e) => ({ key: snapshotEntryKey(e), content: snapshotEntryContent(e) }))
        .filter((e) => e.key && e.content.trim() && !isStub(e.content))
        .map((e) => ({ key: e.key, text: e.content }));
      this.respond(id, true, { path: uri.fsPath, fileName: path.basename(uri.fsPath), entries: wire });
    } catch (e) {
      this.respond(id, false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  /** Rewrite each absorbed entry's body to a `[absorbed→Evermind vN] …` stub, in place,
   *  preserving all other fields. Returns `{ compacted, bytesSaved }`. */
  private async compactMemory(id: string | undefined, filePath?: string, absorbedKeys?: string[], version?: number): Promise<void> {
    try {
      if (!filePath) { this.respond(id, false, undefined, "missing file path"); return; }
      const absorbed = new Set(Array.isArray(absorbedKeys) ? absorbedKeys : []);
      const v = typeof version === "number" ? version : 0;
      const text = await fs.readFile(filePath, "utf8");
      const entries = parseSnapshotArray(text);
      if (!entries) { this.respond(id, false, undefined, vscode.l10n.t("Could not re-read the memory file to compact it.")); return; }
      let compacted = 0;
      let bytesSaved = 0;
      for (const e of entries) {
        const key = snapshotEntryKey(e);
        if (!absorbed.has(key)) continue;
        const content = snapshotEntryContent(e);
        if (!content || isStub(content)) continue;
        const stub = memoryStub(content, v);
        if (stub.length >= content.length) continue; // never grow an entry
        setSnapshotEntryContent(e, stub);
        compacted++;
        bytesSaved += content.length - stub.length;
      }
      if (compacted > 0) await fs.writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`);
      this.respond(id, true, { compacted, bytesSaved });
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
    "ev.flushCta": t("Learn now"),
    "ev.flushing": t("Learning…"),
    "ev.flushedNone": t("Nothing queued to learn yet."),
    "ev.flushedN": t("Merged {merged} contribution(s) into v{version}."),
    // Import from builderforce-memory (editor-only — the host has filesystem access).
    "ev.importTitle": t("Import from builderforce-memory"),
    "ev.importHint": t("Fold a local memory snapshot into this model, then compact the absorbed facts to stubs so they stop filling your context."),
    "ev.importCta": t("Import & compact…"),
    "ev.importing": t("Importing…"),
    "ev.importDone": t("Absorbed {absorbed} memory(ies) into v{version}; compacted {compacted} to stubs (~{savedKb} KB recovered)."),
    "ev.importNothing": t("Nothing to import — no learnable facts in that file."),
    "ev.inspectTitle": t("Recently learned"),
    "ev.inspectEmpty": t("Nothing learned yet. Runs and teaching will appear here."),
    "ev.kindText": t("Run"),
    "ev.kindDelta": t("Delta"),
    "ev.deltaEntry": t("Weight delta contributed by an agent run."),
    "ev.refresh": t("Refresh"),
    "ev.errorGeneric": t("Something went wrong. Try again."),
  };
}
