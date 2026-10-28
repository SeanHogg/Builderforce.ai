import * as vscode from "vscode";
import { isSubscriptionSignInUrl } from "@builderforce/model-catalog";
import { artifactRoutePath, type ChatInputAttachment } from "@seanhogg/builderforce-brain-embedded";
import { getCurrentUserId } from "./bfApi";
import type { BrainRunHost, WebviewRunStart } from "./brainRunHost";
import { getWebBaseUrl } from "./gateway";
import { turnLimbicBlock } from "./personalityLimbic";
import { confirmChatDelete } from "./chatDeletion";
import { getEditorContext, watchEditorContext } from "./editorContext";
import { detectPendingChanges, detectPendingDiff, watchPendingChanges } from "./gitChanges";
import { setSelectedModel, setSelectedModelPool } from "./modelState";
import { hostPageEngines } from "./pageEngineBridge";
import type { ModelFileServer } from "./hostBfi/modelFileServer";
import { captureFromEditor, navigateFromCanvas, openCapturedFile } from "./canvasHostActions";
import type { WorkspaceCanvasSession } from "./workspaceSession";
import { postToWebview, respondToWebview, type WebviewInbound, type WebviewOwner } from "./webviewHostBridge";
import { buildWorkspaceInit } from "./workspaceInit";
import { LocalFetchProxy } from "./localFetchProxy";
import { pickWorkspaceContext } from "./contextPicker";
import { hostAttachmentIngress } from "./hostIngress";
import type { AttachmentIngressRequest } from "./attachmentIngress";

/** Inbound messages unique to the workspace surface (the shared cases live in the bridge). */
export interface BrainInbound extends WebviewInbound {
  name?: string;
  text?: string;
  prompt?: string;
  args?: Record<string, unknown>;
  /** For `open.artifact`: the linked work item to reveal (kind = ChatTicketService
   *  ticket kind; ref = task id as text or a UUID; projectId scopes the board). */
  kind?: string;
  ref?: string;
  projectId?: number;
  /** For `run.start`: the serializable half of the run request (see `brainRunHost.ts`). */
  run?: WebviewRunStart;
  /** For `run.confirm`: the human's answer to the paused tool call. */
  ok?: boolean;
  /** For `run.steer`: image attachments the message was sent with, riding along as
   *  vision parts of the steered turn (a mid-run message keeps its images). */
  attachments?: ChatInputAttachment[];
  /** For `run.autoApprove`: the panel's Auto-mode switch (with `chatId`, the chat it
   *  was flipped in — it applies to that conversation's run and no other). */
  on?: boolean;
  /** For `session.meta`: the chat this surface is showing (id + current title), so a
   *  per-session tab can name itself and bind to the chat it was opened for. */
  chatId?: number;
  title?: string;
  /** For `open.web`: a path on the web app to open in the browser (the host owns the
   *  web base URL), e.g. the pricing or billing page behind an upgrade click. */
  path?: string;
  /** For `changes.open`: the ABSOLUTE path of the uncommitted file whose diff to
   *  open. The webview only echoes back a path the host itself sent it. */
  changePath?: string;
  /** For `changes.open`: that file's git status, so an untracked file opens as a
   *  file rather than as a diff against nothing. */
  changeStatus?: string;
  /** `canvas.capture` — which editor capture to perform. */
  action?: string;
  /** `canvas.openFile` — where in the revealed file to put the selection. */
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  /** `canvas.i18nError` / `canvas.error` — what went wrong. */
  message?: string;
  /** `canvas.error` — where it went wrong, for the report. */
  stack?: string;
  componentStack?: string;
  /** For `model.set`: the composer's model choice — 'auto' (gateway routes),
   *  'byo_pool' (the tenant's connected accounts in priority order), or 'model'
   *  with `model` set to the id to pin. */
  mode?: string;
  model?: string;
  /** For `llm.fetch`: the request the host performs against a local model runtime on
   *  the webview's behalf. `url` is fenced to the configured on-device endpoints. */
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

/** A work item to auto-link to the chat the intent opens, so the conversation is
 *  tied to (and has context on) the item that spawned it. `kind` is a
 *  ChatTicketService ticket kind (task | epic | gap | objective | initiative |
 *  portfolio | roadmap | spec | retro | poker); `ref` is the item id (task id as text,
 *  else a UUID). */
export interface IntentTicket {
  kind: string;
  ref: string;
  title?: string;
  projectId?: number;
}

/** A host-driven request to a workspace surface (mirror of the webview type). */
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

/** Host callbacks so every workspace surface can keep the sidebar trees live. */
export interface WorkspaceSurfaceHooks {
  /** A chat was created / renamed / had activity — refresh the Sessions sidebar. */
  onChatsChanged?: () => void;
  /** A platform (catalog) write happened in the chat — refresh Project & Tasks. */
  onPlatformWrite?: (toolName: string) => void;
  /**
   * The host that EXECUTES the surface's runs. The agent loop lives in the extension
   * host (see `brainRunHost.ts`), so closing or switching away from a surface never
   * ends a run; surfaces start runs, watch them, and re-attach when reopened.
   */
  runHost?: BrainRunHost;
  /**
   * A project was picked on the canvas (null = all projects). The sidebar owns the
   * selection, so the surface hands the pick to the host's ONE selection path rather
   * than keeping a second copy; the change returns to every surface through `init`.
   */
  onSelectProject?: (projectId: number | null) => void;
  /** The host's model file cache, which the webview's `bfi` model store is a view of. */
  modelFiles?: ModelFileServer;
  /** Open a board in the editor (a canvas link followed from any surface). */
  openBoard?: (sessionId: string) => void;
}

/** What a surface needs from whatever VS Code object hosts its webview. */
export interface WorkspaceSurfaceHost {
  readonly webview: vscode.Webview;
  /** The panel or view — the object that knows when the webview is disposed. */
  readonly owner: WebviewOwner;
  /** This host holds only the conversation; the board and the run's changes open in the
   *  visualization panel beside it (the sidebar chat view, which has no room for both). */
  readonly boardBeside?: boolean;
  /** Re-address the workspace init frame for this host (the visualization panel routes
   *  the webview to its own screen). Omitted ⇒ the frame is sent as built. */
  readonly frame?: (init: Record<string, unknown>) => Record<string, unknown>;
  /** Whether this webview offers its page engines (WebGPU `bfi`, WebLLM) to the host's
   *  model routes. Default true. The host prefers the NEWEST offer, so a panel that
   *  holds no conversation must opt out or it takes over the chat's model turns. */
  readonly offersPageEngines?: boolean;
  /** The webview reported the chat it is showing (a tab names itself after it). */
  onSessionMeta?(chatId: number | undefined, title: string | undefined): void;
}

let hooks: WorkspaceSurfaceHooks = {};
const live = new Set<WorkspaceSurface>();

/** Wire host callbacks once (from `activate`) so every surface can refresh the trees. */
export function configureWorkspaceSurfaces(next: WorkspaceSurfaceHooks): void {
  hooks = next;
}

/** Re-push init (token/grounding/model/labels) to every live surface — e.g. after sign-in. */
export function refreshWorkspaceSurfaces(): void {
  for (const surface of live) surface.refresh();
}

/** A chat deleted from the Sessions tree: a surface leaves it only if it is the one open. */
export function notifyChatDeleted(chatId: number): void {
  for (const surface of live) surface.post({ type: "chat.deleted", chatId });
}

/**
 * The workspace surface — the bundled React app (the SAME <BrainTimeline> +
 * brain-embedded core the web app uses, plus the board) bridged to the extension host.
 * It is HOST-AGNOSTIC: the editor tab (`BuilderForcePanel`) and the secondary-sidebar
 * chat view (`BuilderForceChatViewProvider`) each own one and differ only in the
 * VS Code object around the webview, so the chat behaves identically in both.
 *
 * The React app reaches the gateway/API directly (CORS allows the
 * `vscode-webview://` origin). What crosses this bridge is what only the privileged
 * host can do: run the agent loop, touch the workspace and editor, proxy on-device
 * model runtimes, and mint the tenant token.
 */
export class WorkspaceSurface implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly localFetch: LocalFetchProxy;
  /** Intent captured at construction, flushed once the webview signals `ready`. */
  private pendingIntent?: BrainIntent;
  /** Stops relaying the host's runs to this surface (set while the webview is attached). */
  private detachRuns?: () => void;
  /** Detaches this webview's page engines (WebGPU models) from the host's routes. */
  private detachPageEngines?: () => void;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly host: WorkspaceSurfaceHost,
    /** The board this surface is working in, resolved before construction. */
    private session: WorkspaceCanvasSession,
    /** Which surface the LAST entry asked for. */
    private surfaceRequest: "chat" | "graph",
    intent?: BrainIntent,
  ) {
    this.pendingIntent = intent;
    this.localFetch = new LocalFetchProxy(ctx.secrets, host.webview);
    live.add(this);
    this.disposables.push(
      this.localFetch,
      // The canvas picks its palette from the editor theme; re-push init so a theme
      // switch is reflected without reopening the surface.
      vscode.window.onDidChangeActiveColorTheme(() => this.refresh()),
      // Keep the React app's editor context live: whenever the active file, selection,
      // or open tabs change, push a fresh snapshot so the agent always knows what the
      // user is looking at (the same context seeded in `init`).
      watchEditorContext(() => this.pushEditorContext()),
      // Keep the chat's pending-changes bar live: a stage, a commit, a checkout or one
      // of this surface's own mutating tools changes what is waiting for review, and the
      // conversation is where the user is looking when it happens.
      watchPendingChanges(() => void this.pushPendingChanges()),
    );
  }

  /** Re-push init (token / project / model / labels). */
  refresh(): void {
    void this.sendInit();
  }

  /**
   * Point the surface at a (possibly different) surface or board.
   *
   * Re-pushing init is the whole mechanism: the webview reads `surface` as the entry's
   * request and the canvas honours it above its own stored preference (see
   * `initialSurface` in `CreationCanvas`).
   */
  switchTo(surface: "chat" | "graph", session: WorkspaceCanvasSession): void {
    this.surfaceRequest = surface;
    this.session = session;
    this.refresh();
  }

  /** Post a host-driven intent to the React app (new / focus / task / seed). */
  sendIntent(intent: BrainIntent): void {
    this.post({ type: "intent", intent });
  }

  /** Fire-and-forget post to the webview. */
  post(msg: unknown): void {
    postToWebview(this.host.webview, msg, this.host.owner);
  }

  private respond(id: string | undefined, ok: boolean, result?: unknown, error?: string): void {
    respondToWebview(this.host.webview, id, ok, result, error);
  }

  /** This surface's message handling. The host-owned shared cases (`token.refresh`,
   *  `signin`, …) are answered by `handleSharedHostMessage` BEFORE this runs. */
  async handle(msg: BrainInbound): Promise<void> {
    switch (msg.type) {
      case "ready":
        // Watch the host-owned runs from this surface: a reopened one is brought up to
        // date on every live run the moment it asks. Re-attached on each `ready` (a
        // webview reload is a fresh mirror), never twice at once.
        this.detachRuns?.();
        this.detachRuns = hooks.runHost?.attach({ post: (m) => this.post(m) });
        // This webview runs the page engines (WebGPU `bfi`, WebLLM); offer them to the
        // host's pinned and local-first routes for as long as it is up.
        this.detachPageEngines?.();
        this.detachPageEngines = this.host.offersPageEngines === false
          ? undefined
          : hostPageEngines.attach({ post: (m) => this.post(m) });
        // A reloaded webview abandoned any model load it was streaming.
        hooks.modelFiles?.release(this);
        await this.sendInit();
        if (this.pendingIntent) {
          this.sendIntent(this.pendingIntent);
          this.pendingIntent = undefined;
        }
        break;
      // The run verbs, forwarded to the host-owned loop. `run.start` is fire-and-forget
      // here: the host answers with `run.settled` / `run.failed` when the loop ends,
      // which can be minutes later — far past any request timeout.
      case "run.start":
        if (msg.run && typeof msg.run.chatId === "number") void hooks.runHost?.start(msg.run);
        break;
      case "run.stop":
        if (typeof msg.chatId === "number") hooks.runHost?.stop(msg.chatId);
        break;
      case "run.confirm":
        if (typeof msg.chatId === "number") hooks.runHost?.confirm(msg.chatId, msg.ok === true);
        break;
      case "run.steer":
        if (typeof msg.chatId === "number" && typeof msg.text === "string") {
          const attachments = Array.isArray(msg.attachments) ? msg.attachments : undefined;
          // A text attachment reaches the running run as its text, like a normal send;
          // pictures stay vision parts of the steered turn. Queued at once: the texts are
          // only FITTED (synchronously, no compressor or route lookup in front of the steer).
          const text = hostAttachmentIngress(this.ctx.secrets).withInlined(msg.text, attachments?.filter((a) => !a.imageUrl));
          hooks.runHost?.steer(msg.chatId, text, attachments);
        }
        break;
      case "run.clearError":
        if (typeof msg.chatId === "number") hooks.runHost?.clearError(msg.chatId);
        break;
      // Scoped to the chat the surface is showing: several chats run at once out in the
      // host, and a switch flipped in one must not answer a confirm parked in another.
      case "run.autoApprove":
        if (typeof msg.chatId === "number") hooks.runHost?.setAutoApprove(msg.chatId, msg.on === true);
        break;
      // ── The canvas half of the protocol ──────────────────────────────────
      // Delegated to `canvasHostActions`, which holds no surface state.
      case "canvas.capture":
        // A cancelled capture answers null — the canvas treats that as "no change".
        try {
          this.respond(msg.id, true, await captureFromEditor(msg.action));
        } catch (error) {
          // Capture failures are user-facing ("open a file first"), so they belong in
          // the editor's own notification channel, not swallowed into the webview.
          const detail = error instanceof Error ? error.message : String(error);
          void vscode.window.showWarningMessage(detail);
          this.respond(msg.id, false, undefined, detail);
        }
        break;
      case "canvas.openFile":
        if (msg.path) await openCapturedFile(msg.path, msg.range);
        break;
      case "canvas.navigate":
        if (msg.path) navigateFromCanvas(msg.path, (sessionId) => hooks.openBoard?.(sessionId));
        break;
      // The board could not be drawn. It is reported HERE because a webview's console
      // is not somewhere anyone looks, and "the canvas doesn't load" is otherwise a
      // report with nothing attached to it.
      case "canvas.error":
        console.error(`[builderforce] canvas failed to render: ${typeof msg.message === "string" ? msg.message : ""}`, msg.stack, msg.componentStack);
        void vscode.window.showWarningMessage(
          vscode.l10n.t("BuilderForce: the board could not be drawn ({0}). The conversation is still available.", typeof msg.message === "string" ? msg.message : "unknown error"),
        );
        break;
      case "project.select":
        hooks.onSelectProject?.(typeof msg.projectId === "number" ? msg.projectId : null);
        break;
      case "canvas.i18nError":
        // A missing key renders as the key rather than blanking the board; log it so
        // the gap is visible instead of silently shipping raw identifiers.
        console.warn(`[builderforce] canvas i18n: ${typeof msg.message === "string" ? msg.message : ""}`);
        break;
      case "chats.changed":
        hooks.onChatsChanged?.();
        break;
      case "platform.write":
        hooks.onPlatformWrite?.(typeof msg.name === "string" ? msg.name : "");
        break;
      // The webview switched to (or created / renamed) the chat it is showing; the
      // host decides what that means for its chrome (a per-session tab re-keys).
      case "session.meta":
        this.host.onSessionMeta?.(
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
      // The history list's Delete asks the Sessions tree's modal; the webview deletes.
      case "chat.confirmDelete":
        this.respond(msg.id, true, typeof msg.chatId === "number" && await confirmChatDelete(msg.chatId, typeof msg.title === "string" ? msg.title : ""));
        break;
      // Open a linked work item (clicked in the ChatTicketsPanel) in its web view. The
      // routing TABLE is shared (`artifactRoutePath`, brain-embedded); the host only
      // decides which deployment it is opened against.
      case "open.artifact": {
        const path = artifactRoutePath(
          typeof msg.kind === "string" ? msg.kind : "",
          typeof msg.ref === "string" ? msg.ref : null,
          typeof msg.projectId === "number" ? msg.projectId : null,
        );
        void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}${path}`));
        break;
      }
      // Open a web-app page in the browser — the account chip and the error
      // banner's Upgrade / Add-a-card buttons. The webview supplies only the PATH;
      // the host owns the base URL (setting-driven, `getWebBaseUrl`), and the path
      // is constrained to a same-origin absolute path so a compromised webview
      // can't turn this into an open redirect.
      case "open.web": {
        const path = typeof msg.path === "string" ? msg.path : "";
        if (/^\/[^/\\]/.test(path)) {
          void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}${path}`));
        }
        break;
      }
      // Connected accounts → Reconnect: the provider's sign-in page, whose URL the
      // gateway minted (it carries the PKCE challenge, so the host cannot build it).
      // Opened only on a provider's own sign-in domains (the shared provider table),
      // so a compromised webview cannot turn this into an open redirect.
      case "open.external": {
        const url = typeof msg.url === "string" ? msg.url : "";
        if (isSubscriptionSignInUrl(url)) void vscode.env.openExternal(vscode.Uri.parse(url));
        break;
      }
      // The chat's pending-changes bar: open ONE changed file's diff, or take the
      // user to the full Changes list. Both go through the same commands the sidebar
      // uses, so "open" and "review" mean exactly one thing across the extension.
      case "changes.open":
        if (typeof msg.changePath === "string" && msg.changePath) {
          void vscode.commands.executeCommand("builderforce.openChange", {
            path: msg.changePath,
            status: typeof msg.changeStatus === "string" ? msg.changeStatus : "modified",
          });
        }
        break;
      case "changes.review":
        void vscode.commands.executeCommand("builderforce.reviewChanges");
        break;
      // The Visualization panel's before/after rows: the diff text for the same working
      // tree `pendingChanges` lists, re-asked whenever that list moves.
      case "changes.diff":
        try {
          this.respond(msg.id, true, await detectPendingDiff());
        } catch (error) {
          this.respond(msg.id, false, undefined, error instanceof Error ? error.message : String(error));
        }
        break;
      // Run the existing connection-diagnostics command (opens the output channel).
      case "diagnose":
        void vscode.commands.executeCommand("builderforce.diagnose");
        break;
      // The chat header's Visualize lever: the board lives in its own editor panel.
      case "visualization.open":
        void vscode.commands.executeCommand("builderforce.openVisualization");
        break;
      // Composer `/` menu → account settings.
      case "settings":
        void vscode.commands.executeCommand("builderforce.openSettings");
        break;
      // Composer `/` menu → model choice. The surface owns the LIST (it reads the same
      // gateway surface the QuickPick does), but the CHOICE is host state: it drives
      // every editor chat surface and outlives this one, so it is set here. Setting
      // it fires onModelChange → refresh → a fresh `init`, which is how the menu
      // learns what the pick actually resolved to (entitlement may drop a pin).
      case "model.set":
        // The menu has already moved the mode with the pick (brain-ui `ModelPane`), so
        // only the model is set here — never a second, possibly stale, mode write.
        if (msg.mode === "byo_pool") setSelectedModelPool();
        else setSelectedModel(msg.mode === "model" && typeof msg.model === "string" ? msg.model : undefined);
        break;
      // Composer `+` menu → "Add context": pick a workspace file (or the active
      // editor selection) and hand its text back so the webview attaches it.
      case "context.pick":
        this.respond(msg.id, true, await pickWorkspaceContext());
        break;
      // The panel's attachments, through the host so they reach the model: a text kept
      // for the turn's inlined block, a binary uploaded with the extension's credential.
      // A refusal (signed out, upload refused) answers with its sentence for the person.
      case "attachment.ingress":
        try {
          this.respond(msg.id, true, await hostAttachmentIngress(this.ctx.secrets).handle(msg as AttachmentIngressRequest));
        } catch (error) {
          this.respond(msg.id, false, undefined, error instanceof Error ? error.message : String(error));
        }
        break;
      // Per-turn LIMBIC parity: the webview round-trips the turn's text here, where the
      // session's personality (signed-in user's id → their tone and setpoints) is cached.
      // The affect is appraised on this machine — no request per turn — so the next turn
      // runs under the SAME limbic layer as the native participant + cloud/on-prem agents.
      // Best-effort: '' on any failure so the run proceeds unaugmented.
      case "fetchLimbic": {
        let block = "";
        try {
          const userId = (await getCurrentUserId(this.ctx.secrets)) ?? undefined;
          block = await turnLimbicBlock(
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
      case "llm.fetch":
        void this.localFetch.fetch(msg);
        break;
      case "llm.abort":
        this.localFetch.abort(msg.id);
        break;
      // The webview answering the host's page-engine requests (see pageEngineBridge.ts).
      case "pageEngine.probed":
      case "pageEngine.chunk":
      case "pageEngine.end":
      case "pageEngine.error":
      case "pageEngine.alive":
        hostPageEngines.receive(msg);
        break;
      // The webview's bfi model store, backed by the host's file cache (hostBfi/modelFileServer.ts).
      case "modelFile.status":
      case "modelFile.open":
      case "modelFile.read":
      case "modelFile.remove":
      case "modelFile.download":
      case "modelFile.support":
      case "modelFile.close":
      case "modelFile.cancel":
        hooks.modelFiles?.handle(msg, {
          respond: (id, ok, result, error) => this.respond(id, ok, result, error),
          post: (m) => this.post(m),
          owner: this,
        });
        break;
    }
  }

  /**
   * Push the live editor context (active file / selection / open tabs / workspace
   * root / git) to the React app. Driven by `watchEditorContext`, which also fires on
   * repository state changes, so a branch checkout re-pushes the branch the agent is
   * told it is working on.
   */
  private pushEditorContext(): void {
    const editorContext = getEditorContext();
    this.post({
      type: "editorContext",
      editorContext,
      // Mirrored at the top level so consumers reading workspace/git state off the
      // init payload see the same fields on every update.
      workspaceRoot: editorContext?.workspaceRoot,
      git: editorContext?.git,
    });
  }

  /**
   * Push the workspace's uncommitted work to the React app, so the chat states that a
   * turn left code on disk instead of leaving the transcript as the only record of it.
   * Same read the Changes sidebar renders — one count, two surfaces.
   */
  private async pushPendingChanges(): Promise<void> {
    this.post({ type: "pendingChanges", pendingChanges: await detectPendingChanges() });
  }

  /** The latest `init` being built: one pick fires several refreshes, and an older build
   *  (read before the pick landed) must never be posted after a newer one. */
  private initSeq = 0;
  private latestInit: Promise<void> = Promise.resolve();

  /** Resolves once the NEWEST init is posted — a superseded build waits on it rather than
   *  returning early, so a caller (`ready`) still posts after an init has landed. */
  private sendInit(): Promise<void> {
    const seq = ++this.initSeq;
    const run = (async (): Promise<void> => {
      const init = await buildWorkspaceInit(this.ctx, {
        session: this.session,
        surface: this.surfaceRequest,
        boardBeside: !!this.host.boardBeside,
        // Only the newest init re-pushes: a superseded build's callback would post a duplicate.
        onGroundingLate: () => { if (live.has(this) && seq === this.initSeq) this.refresh(); },
      });
      if (seq !== this.initSeq) return this.latestInit;
      this.post(this.host.frame ? this.host.frame(init) : init);
    })();
    this.latestInit = run;
    return run;
  }

  dispose(): void {
    live.delete(this);
    // The run itself lives in the host and carries on; only this VIEW of it goes.
    this.detachRuns?.();
    this.detachRuns = undefined;
    this.detachPageEngines?.();
    this.detachPageEngines = undefined;
    hooks.modelFiles?.release(this);
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* noop */
      }
    }
  }
}
