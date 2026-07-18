import * as vscode from "vscode";
import { getTenantJwt, getCurrentUserId } from "./bfApi";
import { TOOL_DEFS } from "./fileTools";
import { getBaseUrl, getWebBaseUrl, SECRET_KEY, fetchPersonalityBlock, fetchLimbicBlock, getSessionTabMode, type SessionTabMode } from "./gateway";
import { attentionFor, sessionTabIcon, sessionTabPrefix } from "./attention";
import { getGroundingSummary } from "./grounding";
import { getEditorContext, getEditorContextLive, watchEditorContext } from "./editorContext";
import { resolveEffectiveModel } from "./modelState";
import { getSelectedProject } from "./projectState";
import { getProjectNames } from "./projectNames";
import { WebviewPanelBase, type WebviewInbound } from "./webviewShared";

/** Inbound messages unique to the Brain panel (the shared cases live in the base). */
interface BrainInbound extends WebviewInbound {
  name?: string;
  text?: string;
  prompt?: string;
  args?: Record<string, unknown>;
  /** For `open.artifact`: the linked work item to reveal (kind = ChatTicketService
   *  ticket kind; ref = task id as text or a UUID; projectId scopes the board). */
  kind?: string;
  ref?: string;
  projectId?: number;
  /** For `runs.local`: chat ids the webview's agent loop is executing / paused on. */
  running?: number[];
  awaiting?: number[];
  /** For `session.meta`: the chat this panel is showing (id + current title), so a
   *  per-session tab can name itself and bind to the chat it was opened for. */
  chatId?: number;
  title?: string;
}

/** A work item to auto-link to the chat the intent opens, so the conversation is
 *  tied to (and has context on) the item that spawned it. `kind` is a
 *  ChatTicketService ticket kind (task | epic | gap | objective | initiative |
 *  portfolio | roadmap); `ref` is the item id (task id as text, else a UUID). */
export interface IntentTicket {
  kind: string;
  ref: string;
  title?: string;
  projectId?: number;
}

/** A host-driven request to the singleton Brain panel (mirror of the webview type). */
export interface BrainIntent {
  kind: "new" | "focus" | "task" | "seed";
  chatId?: number;
  /** For 'seed': a prompt pre-filled into a fresh chat (editor entry points). */
  text?: string;
  task?: { id: number; key?: string; title: string; taskType?: "task" | "epic" | "gap"; projectId?: number; dispatched?: boolean };
  /** Auto-link this work item to the chat once it's created (task/roadmap/etc.). For
   *  a 'seed' intent this also forces the chat to be created eagerly so the link
   *  lands (an editor-entry 'seed' with no ticket stays lazy). */
  ticket?: IntentTicket;
}

/** Host callbacks so the Brain panel can keep the sidebar trees live. */
export interface BrainWebviewHooks {
  /** A chat was created / renamed / had activity — refresh the Sessions sidebar. */
  onChatsChanged?: () => void;
  /** A platform (catalog) write happened in the chat — refresh Project & Tasks. */
  onPlatformWrite?: (toolName: string) => void;
  /**
   * The set of chats the in-webview Brain loop is currently running / paused on a
   * confirm changed. The agent loop lives in the webview (it streams straight to
   * the gateway), so the server-side attention endpoint never sees it — the host
   * merges this into the same live-status map so the Sessions tree lights up the
   * still-running conversations after the user switches to a new chat.
   *
   * `sourceId` identifies the reporting PANEL: in `sessionTabs:perSession` several
   * panels report concurrently, each seeing only its own chat, so the merge must be
   * per-source or the last reporter would erase the others' runs.
   */
  onLocalRunsChanged?: (sourceId: string, runs: { running: number[]; awaiting: number[] }) => void;
}

/**
 * Localized UI strings handed to the bundled React webview. The webview ships no
 * i18n stack of its own (next-intl is web-only), so the host translates here via
 * `vscode.l10n` (editor display language) and forwards the bundle through `init`.
 * Keys are the webview's namespace; the l10n lookup is keyed off the English message.
 */
function buildLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    // <BrainTimeline> (shared transcript UI)
    "tl.thinking": t("Thinking…"),
    "tl.thoughtFor": t("Thought for {duration}"),
    "tl.you": t("You"),
    "tl.assistant": "BuilderForce",
    "tl.input": t("Input"),
    "tl.output": t("Output"),
    "tl.error": t("Error"),
    "tl.loading": t("Loading…"),
    "tl.empty": t("Ask BuilderForce to build or change something."),
    "tl.copy": t("Copy"),
    "tl.copied": t("Copied"),
    "tl.apply": t("Apply"),
    "tl.createFile": t("Create file"),
    "tl.preview": t("Preview"),
    // Composer + chrome
    "app.signInPrompt": t("Sign in to BuilderForce to start."),
    "app.signIn": t("Sign in"),
    "app.beta": t("beta"),
    "app.newChat": t("New chat"),
    "app.conversation": t("Conversation"),
    "app.rename": t("Rename chat"),
    "app.renamePlaceholder": t("Chat name"),
    "app.noProject": t("No project"),
    "app.copyChat": t("Copy chat diagnostics (identity + Evermind state + transcript)"),
    // Pending ask_user question, restated at the composer so a blocked chat is
    // answerable without hunting back through the transcript for its card.
    "app.askPending": t("Answer needed"),
    "app.askJumpTo": t("Show in conversation"),
    // Consolidate + Fork composer actions
    "app.consolidate": t("Consolidate"),
    "app.consolidateHint": t("Summarize this chat into a compact context the rest of the conversation builds on"),
    "app.consolidating": t("Consolidating…"),
    "app.fork": t("Fork"),
    "app.forkHint": t("Summarize this chat and continue in a new one from that summary"),
    "app.forking": t("Forking…"),
    "app.forkTitle": t("Fork of {title}"),
    // Per-chat project-Evermind memory switch
    "app.memory": t("Memory"),
    "app.memoryOnHint": t("Memory on — this chat recalls and learns from the project Evermind"),
    "app.memoryOffHint": t("Memory off — this chat is a scratch space (no recall, no learning)"),
    "app.diagnostics": t("Run connection diagnostics"),
    "app.attachImage": t("Attach image"),
    "app.remove": t("Remove"),
    // Composer toolbar (Claude-style + / menus, auto mode, dictation)
    "app.add": t("Add"),
    "app.options": t("Options"),
    "app.uploadFile": t("Upload from computer"),
    "app.uploading": t("Uploading…"),
    "app.addContext": t("Add context"),
    "app.browseWeb": t("Browse the web"),
    "app.on": t("On"),
    "app.off": t("Off"),
    "app.effort": t("Effort"),
    "app.effortQuick": t("Quick"),
    "app.effortBalanced": t("Balanced"),
    "app.effortThorough": t("Thorough"),
    "app.thinking": t("Thinking"),
    "app.accountSettings": t("Account settings"),
    "app.autoMode": t("Auto mode"),
    "app.autoModeHint": t("Auto-approve tool actions without asking"),
    "app.pickModel": t("Change model"),
    "app.dictate": t("Dictate"),
    "app.stopDictation": t("Stop dictation"),
    "app.working": t("Working…"),
    "app.send": t("Send"),
    "app.stop": t("Stop"),
    // Queue-while-running: messages composed during an in-flight run are queued and
    // drained one per completed run instead of being dropped.
    "app.queueSend": t("Queue message — sends when the current run finishes"),
    "app.queuedLabel": t("Queued messages"),
    "app.queuedHint": t("Queued — sends when the run finishes"),
    "app.placeholder": t("Ask BuilderForce to build or change something…"),
    "app.confirmRun": t("Run {name}?"),
    "app.approve": t("Approve"),
    "app.cancel": t("Cancel"),
    "app.always": t("Always"),
    "app.dismiss": t("Dismiss"),
    "app.reconnect": t("Reconnect"),
    "app.byoUnused": t("Your connected {provider} account couldn’t be used this run (its token looks expired or revoked), so it ran on the shared model pool instead of your own model. Reconnect it in the web app under Settings ▸ API Keys."),
    "app.byoOtherWorkspace": t("Your {provider} account is connected in a DIFFERENT workspace, so this run used the shared model pool instead of your own model. Switch to that workspace, or connect it in this one under Settings ▸ API Keys."),
    "app.taskSeed": t("Let's work on {task}."),
    "app.taskSeedDispatched": t("I just dispatched {task} to run on the platform. Check the latest execution's status and trace, then help me follow up."),
  };
}

/**
 * The unified BuilderForce Brain — a bundled React webview (the SAME
 * <BrainTimeline> + brain-embedded core the web app uses), so the chat experience
 * is identical on the web and in VS Code, backed by the same server-side `/api/brain`
 * conversations. This is the ONE chat surface in the editor: the Sessions sidebar
 * and task commands all drive it (there is no separate legacy chat panel).
 *
 * The React app reaches the gateway/API directly (CORS allows the
 * `vscode-webview://` origin) — including the shared MCP tool catalog. Two things
 * only the privileged host can do cross a typed postMessage bridge:
 *   - local file tools (read/list/write/edit/delete) run here against the workspace
 *   - the tenant token is minted/refreshed here from the stored editor key
 */
export class BrainWebview extends WebviewPanelBase<BrainInbound> {
  /** The single reused panel (`sessionTabs:reuse` — the default). */
  private static reused: BrainWebview | undefined;
  /** `sessionTabs:perSession`: one panel per chat id, so sessions are switchable tabs. */
  private static readonly byChat = new Map<number, BrainWebview>();
  /** perSession panels for a chat that has no server id yet (a 'new'/'seed' intent);
   *  each re-keys itself into {@link byChat} once the webview reports its chat. */
  private static readonly unassigned = new Set<BrainWebview>();
  private static hooks: BrainWebviewHooks = {};
  private static seq = 0;

  /** Wire host callbacks once (from `activate`) so the panel can refresh the trees. */
  static configure(hooks: BrainWebviewHooks): void {
    BrainWebview.hooks = hooks;
  }

  /** Every live Brain panel, whichever registry holds it. */
  private static allPanels(): BrainWebview[] {
    return [
      ...(BrainWebview.reused ? [BrainWebview.reused] : []),
      ...BrainWebview.byChat.values(),
      ...BrainWebview.unassigned,
    ];
  }

  /**
   * Open (or reveal) the Brain on `intent`. In `reuse` mode one panel is kept and the
   * intent switches the conversation inside it. In `perSession` mode each session gets
   * its own tab: focusing a session that is already open reveals ITS tab rather than
   * stealing another one, so the user can switch between chats like editor tabs.
   */
  static open(ctx: vscode.ExtensionContext, intent?: BrainIntent): void {
    const mode = getSessionTabMode();

    if (mode === "reuse") {
      if (BrainWebview.reused) {
        BrainWebview.reused.panel.reveal();
        if (intent) BrainWebview.reused.sendIntent(intent);
        return;
      }
      BrainWebview.reused = new BrainWebview(ctx, intent, mode);
      return;
    }

    // perSession: an already-open session just comes forward — never duplicated, and
    // never switched out from under another tab.
    if (intent?.kind === "focus" && intent.chatId != null) {
      const open = BrainWebview.byChat.get(intent.chatId);
      if (open) {
        open.panel.reveal();
        return;
      }
    }
    const panel = new BrainWebview(ctx, intent, mode);
    if (intent?.kind === "focus" && intent.chatId != null) {
      panel.ownChatId = intent.chatId;
      BrainWebview.byChat.set(intent.chatId, panel);
      panel.applyTabStatus();
    } else {
      // 'new'/'seed'/'task' — the chat id only exists once the webview creates it.
      BrainWebview.unassigned.add(panel);
    }
  }

  /** Re-push init (token/grounding/model/labels) to every open panel — e.g. after sign-in. */
  static refresh(): void {
    for (const panel of BrainWebview.allPanels()) void panel.sendInit();
  }

  /**
   * Repaint every per-session tab's live status. Called from the SAME handlers that
   * already repaint the trees on an attention change, so tabs ride the one existing
   * poller + local-run overlay — no second timer, no extra fetch.
   */
  static refreshTabStatus(): void {
    for (const panel of BrainWebview.byChat.values()) panel.applyTabStatus();
    for (const panel of BrainWebview.unassigned) panel.applyTabStatus();
  }

  /** Intent captured at construction, flushed once the webview signals `ready`. */
  private pendingIntent?: BrainIntent;
  /** The chat this panel is bound to (perSession); undefined until the webview reports one. */
  private ownChatId?: number;
  /** The bound chat's title — the per-session tab's label. */
  private chatTitle = "";
  /** Identifies this panel in the shared local-run overlay (see BrainWebviewHooks). */
  private readonly sourceId = `brain:${++BrainWebview.seq}`;

  private constructor(ctx: vscode.ExtensionContext, intent: BrainIntent | undefined, private readonly mode: SessionTabMode) {
    super(ctx, { viewType: "builderforce.brain", title: "BuilderForce", htmlTitle: "BuilderForce" });
    this.pendingIntent = intent;
    // Keep the React app's editor context live: whenever the active file, selection,
    // or open tabs change, push a fresh snapshot so the agent always knows what the
    // user is looking at (the same context seeded in `init`).
    this.disposables.push(watchEditorContext(() => this.pushEditorContext()));
  }

  protected async onMessage(msg: BrainInbound): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendInit();
        if (this.pendingIntent) {
          this.sendIntent(this.pendingIntent);
          this.pendingIntent = undefined;
        }
        break;
      case "tool.call":
        await this.runTool(msg.id, msg.name, msg.args);
        break;
      case "chats.changed":
        BrainWebview.hooks.onChatsChanged?.();
        break;
      case "platform.write":
        BrainWebview.hooks.onPlatformWrite?.(typeof msg.name === "string" ? msg.name : "");
        break;
      // The set of chats the webview's agent loop is executing / paused on changed
      // — forward it so the Sessions tree lights up the still-live conversations.
      case "runs.local": {
        const nums = (v: unknown): number[] =>
          Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
        // Repainting this panel's tab rides the overlay's change event (which the host
        // already fans out to refreshTabStatus) — no direct call needed here.
        BrainWebview.hooks.onLocalRunsChanged?.(this.sourceId, {
          running: nums(msg.running),
          awaiting: nums(msg.awaiting),
        });
        break;
      }
      // The webview switched to (or created / renamed) the chat it is showing. A
      // per-session tab binds to that chat here: it re-keys itself under the new id
      // and names the tab after the conversation.
      case "session.meta":
        this.bindSession(
          typeof msg.chatId === "number" ? msg.chatId : undefined,
          typeof msg.title === "string" ? msg.title : undefined,
        );
        break;
      // Triage: the webview built a full transcript (turns + tool I/O + errors);
      // the privileged host writes it to the clipboard reliably (a sandboxed
      // webview can't), so a "No response" turn can be pasted out to debug.
      case "copy":
        await vscode.env.clipboard.writeText(typeof msg.text === "string" ? msg.text : "");
        void vscode.window.showInformationMessage(vscode.l10n.t("Chat diagnostics copied to clipboard."));
        break;
      // Open a linked work item (clicked in the ChatTicketsPanel) in its own view:
      // a task/epic/gap deep-links to its detail drawer (assignee/status/PRD) in the
      // web portal; strategy tiers + specs open the web page they live on.
      case "open.artifact":
        this.openArtifact(
          typeof msg.kind === "string" ? msg.kind : "",
          typeof msg.projectId === "number" ? msg.projectId : undefined,
          typeof msg.ref === "string" ? msg.ref : undefined,
        );
        break;
      // Run the existing connection-diagnostics command (opens the output channel).
      case "diagnose":
        void vscode.commands.executeCommand("builderforce.diagnose");
        break;
      // Composer `/` menu → account settings, and the model chip → model picker.
      case "settings":
        void vscode.commands.executeCommand("builderforce.openSettings");
        break;
      case "pickModel":
        void vscode.commands.executeCommand("builderforce.pickModel");
        break;
      // Composer `+` menu → "Add context": pick a workspace file (or the active
      // editor selection) and hand its text back so the webview attaches it.
      case "context.pick": {
        const picked = await this.pickContext();
        this.respond(msg.id, true, picked);
        break;
      }
      // Per-turn LIMBIC parity: the webview can't call the gateway's affective
      // endpoint with the user's personality directly, so it round-trips the turn's
      // text here. We fetch the fresh affect + PERSONALITY block (signed-in user's
      // id → their tone) so the next turn runs under the SAME limbic layer as the
      // native participant + cloud/on-prem agents. Best-effort: '' on any failure so
      // the run proceeds unaugmented.
      case "fetchLimbic": {
        let block = "";
        try {
          const userId = (await getCurrentUserId(this.ctx.secrets)) ?? undefined;
          block = await fetchLimbicBlock(
            this.ctx.secrets,
            typeof msg.text === "string" ? msg.text : "",
            userId ? { userId } : undefined,
          );
        } catch {
          /* affective layer is best-effort — never blocks the turn */
        }
        this.respond(msg.id, true, { block });
        break;
      }
    }
  }

  /**
   * Reveal a linked work item the user opened from the ChatTicketsPanel. A task/epic/gap
   * opens its DETAIL view — the ticket's assignee/status/PRD drawer — via the web portal
   * deep-link (`&task=<ref>`), which is the only surface that renders those details (the
   * native BoardPanel is a Kanban board with no detail drawer, so it can't satisfy "open
   * the ticket details"). The strategy tiers (objective/initiative/portfolio) + specs
   * open the web page they live on. Mirrors the web app's own onOpenTicket routing so
   * "Open" behaves the same on both surfaces.
   */
  private openArtifact(kind: string, projectId?: number, ref?: string): void {
    let path: string;
    if (kind === "objective" || kind === "initiative" || kind === "portfolio") {
      path = "/projects?tab=portfolio";
    } else {
      const base = projectId != null ? `/projects?tab=tasks&project=${projectId}` : "/projects?tab=tasks";
      // task/epic/gap → deep-link straight into the ticket's detail drawer.
      path = (kind === "task" || kind === "epic" || kind === "gap") && ref
        ? `${base}&task=${encodeURIComponent(ref)}`
        : base;
    }
    void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}${path}`));
  }

  /**
   * Let the user attach workspace context to a message: the active editor's
   * selection, an already-open file, or any file chosen from disk. Returns the
   * relative path + text (or null if cancelled) — the webview attaches it through
   * the same upload pipeline as a dropped file, so the model gets the content.
   */
  private async pickContext(): Promise<{ path: string; text: string } | null> {
    // Note: the discriminator is `ctxKind`, not `kind` — `QuickPickItem.kind` is
    // reserved by VS Code (separator vs default), so reusing it collapses to never.
    type Item = vscode.QuickPickItem & { ctxKind: "selection" | "doc" | "browse"; uri?: vscode.Uri };
    const editor = vscode.window.activeTextEditor;
    const items: Item[] = [];
    if (editor && !editor.selection.isEmpty) {
      items.push({
        label: "$(selection) " + vscode.l10n.t("Active selection"),
        description: vscode.workspace.asRelativePath(editor.document.uri),
        ctxKind: "selection",
      });
    }
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "file" || doc.isUntitled) continue;
      items.push({ label: "$(file) " + vscode.workspace.asRelativePath(doc.uri), ctxKind: "doc", uri: doc.uri });
    }
    items.push({ label: "$(search) " + vscode.l10n.t("Choose a file…"), ctxKind: "browse" });

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t("Add context from your workspace"),
    });
    if (!pick) return null;

    if (pick.ctxKind === "selection" && editor) {
      return { path: vscode.workspace.asRelativePath(editor.document.uri), text: editor.document.getText(editor.selection) };
    }
    let uri = pick.uri;
    if (!uri) {
      const chosen = await vscode.window.showOpenDialog({
        canSelectMany: false,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      });
      uri = chosen?.[0];
    }
    if (!uri) return null;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      return { path: vscode.workspace.asRelativePath(uri), text: doc.getText() };
    } catch {
      return null;
    }
  }

  /** Post a host-driven intent to the React app (new / focus / task). */
  private sendIntent(intent: BrainIntent): void {
    void this.panel.webview.postMessage({ type: "intent", intent });
  }

  /**
   * Bind this panel to the chat its webview is showing. In perSession mode the panel
   * re-keys itself in the registry — this is how a tab opened for a BRAND-NEW chat
   * (which has no id until the webview creates it server-side) becomes switchable and
   * starts tracking its own live status. In reuse mode only the title is recorded.
   */
  private bindSession(chatId: number | undefined, title: string | undefined): void {
    if (title !== undefined) this.chatTitle = title;
    if (this.mode === "perSession" && chatId !== this.ownChatId) {
      if (this.ownChatId != null && BrainWebview.byChat.get(this.ownChatId) === this) {
        BrainWebview.byChat.delete(this.ownChatId);
      }
      this.ownChatId = chatId;
      if (chatId != null) {
        // Another tab already holds this chat (e.g. the webview navigated onto it) —
        // it loses the key so exactly one tab owns a session.
        BrainWebview.byChat.set(chatId, this);
        BrainWebview.unassigned.delete(this);
      } else {
        BrainWebview.unassigned.add(this);
      }
    }
    this.applyTabStatus();
  }

  /**
   * Paint this tab with its chat's title + live status, so a user juggling sessions
   * sees which one is working and which one needs an answer WITHOUT opening it —
   * the same signal the Sessions row shows, off the same {@link attentionFor} map.
   * Reuse mode keeps the product title (its one tab is not a single session).
   */
  private applyTabStatus(): void {
    if (this.mode !== "perSession") return;
    const state = this.ownChatId != null ? attentionFor("chat", this.ownChatId) : undefined;
    const name = this.chatTitle.trim() || "BuilderForce";
    this.panel.title = `${sessionTabPrefix(state)}${name}`;
    this.panel.iconPath = sessionTabIcon(this.ctx.extensionUri, state);
  }

  /** Push the current editor context (active file / selection / open tabs) to the
   *  React app so its ambient system channel stays in sync as the user navigates. */
  /**
   * Push the live editor context (active file / selection / open tabs / workspace
   * root / git) to the React app. Driven by `watchEditorContext`, which now also
   * fires on repository state changes, so a branch checkout re-pushes the branch the
   * agent is told it is working on.
   */
  private pushEditorContext(): void {
    const editorContext = getEditorContext();
    void this.panel.webview.postMessage({
      type: "editorContext",
      editorContext,
      // Mirrored at the top level so consumers reading workspace/git state off the
      // init payload see the same fields on every update.
      workspaceRoot: editorContext?.workspaceRoot,
      git: editorContext?.git,
    });
  }

  /** Hand the React app its config: gateway URL, tenant token, model, grounding, tools, labels. */
  private async sendInit(): Promise<void> {
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    const token = signedIn ? ((await getTenantJwt(this.ctx.secrets)) ?? null) : null;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Awaited (not peeked) so the FIRST turn already knows the repo — the whole
    // point of shipping this: the agent must not open a chat asking where the code is.
    const editorContext = await getEditorContextLive();
    // `projectId → name` for every project, so the header can name the project an
    // existing chat belongs to (best-effort; falls back to "No project").
    const projectNames: Record<string, string> = {};
    if (signedIn) {
      try {
        for (const [id, name] of await getProjectNames(this.ctx.secrets)) projectNames[String(id)] = name;
      } catch {
        /* names are best-effort */
      }
    }
    // The signed-in user's PERSONALITY-only directive block — fetched once per
    // session (cached in the gateway helper) and injected into the webview's
    // ambient system channel, so the Brain chat's tone reflects the user. The
    // webview can't bundle the shared compiler (--no-dependencies), so the host
    // fetches the compiled block from the gateway. '' when the user has no
    // profile (a no-op) or offline.
    let personalityBlock = "";
    if (signedIn) {
      try {
        const userId = (await getCurrentUserId(this.ctx.secrets)) ?? undefined;
        personalityBlock = await fetchPersonalityBlock(this.ctx.secrets, userId ? { userId } : undefined);
      } catch {
        /* personality is best-effort — never blocks init */
      }
    }
    void this.panel.webview.postMessage({
      type: "init",
      baseUrl: getBaseUrl(),
      token,
      // Manual pick > active project's Evermind pin > configured default. Sending the
      // `project_evermind:<id>` pin lets the gateway serve the project's CURRENT learned
      // model on every completion (auto-following learning bumps mid-session).
      model: await resolveEffectiveModel(this.ctx.secrets),
      grounding: root ? getGroundingSummary() : undefined,
      // Live editor context (active file / selection / open tabs). Seeds the React
      // app's ambient system channel; refreshed via `editorContext` messages below.
      editorContext,
      signedIn,
      hasWorkspace: !!root,
      // WHERE THE CODE IS: the absolute root the local file tools resolve against,
      // and the repository detected for it (branch / owner-repo / dirty state).
      // `hasWorkspace` is kept — other consumers read it.
      workspaceRoot: root,
      git: editorContext?.git,
      // The sidebar's active project — injected into the system prompt (so the
      // Brain scopes platform tools without asking for a projectId) AND used to
      // scope newly-created chats. Re-pushed on project change via refresh().
      project: getSelectedProject(),
      projectNames,
      // Static personality tone for the chat's system prompt (see above).
      personalityBlock,
      // The local file tools, forwarded so the model can call them over the bridge.
      // (The shared platform catalog is fetched by the webview directly from the gateway.)
      tools: TOOL_DEFS.map((d) => ({
        name: d.name,
        description: d.description,
        parameters: d.parameters,
        mutating: d.mutating,
      })),
      labels: buildLabels(),
    });
  }

  /** Execute a local file tool against the workspace and return its result string. */
  private async runTool(id: string | undefined, name: string | undefined, args: Record<string, unknown> = {}): Promise<void> {
    const def = TOOL_DEFS.find((d) => d.name === name);
    if (!def) {
      this.respond(id, false, undefined, `Unknown tool: ${name}`);
      return;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.respond(id, false, undefined, `Tool "${name}" needs an open workspace folder.`);
      return;
    }
    try {
      const result = await def.execute(args, root);
      this.respond(id, true, result);
      // Link the change back to the editor: reveal the file the agent just wrote
      // or edited so the user SEES each change land (a preview tab beside the
      // chat, focus preserved). Fire-and-forget — never blocks the tool result.
      void this.revealChangedFile(name, args, root);
    } catch (e) {
      this.respond(id, false, undefined, (e as Error).message ?? String(e));
    }
  }

  /**
   * Open the file a mutating file tool just touched, so the change is visible in
   * the editor (VS Code auto-reloads the on-disk edit). Preview mode reuses one
   * tab across a multi-file run, opened Beside the chat with focus preserved so
   * it never steals the composer. Only `write_file`/`edit_file` reveal — a delete
   * has nothing to show, and shell/read tools aren't changes. Best-effort.
   */
  private async revealChangedFile(name: string | undefined, args: Record<string, unknown>, root: string): Promise<void> {
    if (name !== "write_file" && name !== "edit_file") return;
    const rel = typeof args.path === "string" ? args.path : "";
    if (!rel) return;
    try {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(root), ...rel.split("/").filter(Boolean));
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: true,
        viewColumn: vscode.ViewColumn.Beside,
      });
    } catch {
      /* file may have been deleted/moved by a later tool — non-fatal */
    }
  }

  protected onDispose(): void {
    if (BrainWebview.reused === this) BrainWebview.reused = undefined;
    if (this.ownChatId != null && BrainWebview.byChat.get(this.ownChatId) === this) {
      BrainWebview.byChat.delete(this.ownChatId);
    }
    BrainWebview.unassigned.delete(this);
    // Closing the panel destroys the webview's JS context, so its in-flight runs
    // are gone — retire THIS panel's indicators from the Sessions tree. Scoped to
    // its own source so closing one tab never clears another tab's live runs.
    BrainWebview.hooks.onLocalRunsChanged?.(this.sourceId, { running: [], awaiting: [] });
  }
}
