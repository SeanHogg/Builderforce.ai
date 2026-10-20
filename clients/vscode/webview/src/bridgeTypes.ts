/**
 * The data shapes the host sends across the bridge (`init`, `intent`). Pure types —
 * re-exported from `./vscodeBridge`, which is the import path callers use.
 */

import type { PlatformPolicySnapshot } from '@builderforce/local-first';
import type { ModelChoiceLabels } from '@seanhogg/builderforce-brain-embedded';
import type { EditorContext } from '../../src/idePersona';
import type { PendingChangeSet } from '../../src/gitChangeModel';

/**
 * A localized string bundle the host builds from its `vscode.l10n` catalog and
 * passes through `init`, so the bundled React UI renders in the editor's display
 * language without shipping its own i18n stack (next-intl is web-only).
 */
export type LabelBundle = Record<string, string>;

/**
 * A request from the host (Sessions sidebar / task command) to drive the singleton
 * Brain panel: open a fresh chat, focus an existing one, or seed a task-scoped chat.
 */
export interface BrainIntent {
  kind: 'new' | 'focus' | 'task' | 'seed' | 'revalidate';
  /** For 'focus': the server chat id to load. */
  chatId?: number;
  /** For 'seed': open a fresh chat with this prompt pre-filled in the composer, so an
   *  editor entry point (review PRs / fix errors / open a PR) hands the unified Brain a
   *  job to do with its shared platform + git tools. */
  text?: string;
  /** For 'task': the BuilderForce task to scope a new chat to. `dispatched` marks a
   *  task that was just handed to the platform runtime, so the seed nudges the Brain
   *  to monitor the run (via the `executions.*` platform tools) rather than start work. */
  task?: { id: number; key?: string; title: string; taskType?: 'task' | 'epic' | 'gap'; projectId?: number; dispatched?: boolean };
  /** Auto-link this work item to the chat the intent opens (task/roadmap/spec/…), so
   *  the conversation is tied to — and has context on — the item that spawned it. For a
   *  'seed' intent a ticket also forces the chat to be created eagerly so the link lands
   *  (a ticket-less editor 'seed' stays lazy until the first message). `kind` is a
   *  ChatTicketService kind (task | epic | gap | objective | initiative | portfolio | roadmap). */
  ticket?: { kind: string; ref: string; title?: string; projectId?: number };
}

export interface InitData {
  auditResult?: { codeAnalysis?: import('@builderforce/agent-tools').CodeAnalysisComparison };
  baseUrl: string;
  token: string | null;
  /** Host-owned capability permissions; internet reachability alone enables nothing. */
  platformPolicy: PlatformPolicySnapshot;
  model?: string;
  modelStrict?: boolean;
  routingMode?: 'auto' | 'byo_pool';
  /**
   * Set when the selected model is served by a runtime on THIS machine. Its presence is
   * what switches the chat transport onto the host-proxied path (`hostFetch`) and, since
   * such a turn needs no account, what lets the panel render signed out.
   *
   * Resolved by the host's `modelRouting` seam — the webview never derives it, so this
   * surface cannot drift from the chat participant the way the codebase scanner once did.
   */
  localRoute?: { baseUrl: string; model: string };
  grounding?: string;
  signedIn: boolean;
  /** The configured `builderforce.permissionMode`, as a boolean: the standing answer to
   *  "apply edits without asking?". Seeds the Auto-mode switch, which overrides it live.
   *  Re-pushed when the setting changes, so an open panel follows it. */
  autoApproveDefault?: boolean;
  /** Models served by a runtime on this machine, ready for the shared list builder.
   *  Empty when the feature is off or no runtime is reachable. */
  localModels?: Array<{ id: string; label: string; runtime: string }>;
  hasWorkspace: boolean;
  /** The live editor context (active file / selection / open tabs) at init time.
   *  Kept fresh afterwards via `editorContext` messages (see {@link onEditorContext}). */
  editorContext?: EditorContext;
  /** The workspace's uncommitted work when the panel opened — what the chat's
   *  pending-changes bar renders. Kept fresh afterwards via `pendingChanges` messages
   *  (see {@link onPendingChanges}); absent on a host with no workspace or no git. */
  pendingChanges?: PendingChangeSet;
  /** Which screen this webview should render. The bundled React app is multi-screen:
   *  the host decides via `init` which surface this panel is — the Brain chat (default),
   *  Project 360, a list-shaped project page (Backlog / PRDs), the Evermind console, or the
   *  split-view Visualization board — same bundle, same transport, one code path. */
  view?: 'workspace' | 'project360' | 'backlog' | 'prd' | 'roadmap' | 'retros' | 'poker' | 'evermind' | 'visualization' | 'audit-result';
  /**
   * Which SURFACE the workspace opens at — the difference between "open my chat" and
   * "open my canvas", which used to be the difference between two panels.
   *
   * A `CanvasSurfaceId` (`chat` | `graph` | …), sanitised by the webview against the
   * shared registry, so an unknown value degrades to the board rather than blanking
   * the panel. Absent means "wherever you were": the canvas restores its own stored
   * preference, because that is what reopening a panel you never closed should do.
   */
  surface?: string;
  /** The durable Creation Session this panel is editing.
   *  `webOrigin` builds shareable links: a webview's own origin is
   *  `vscode-webview://…`, which is useless to whoever receives an invitation. */
  session?: {
    id: string;
    title: string;
    webOrigin: string;
    /** False for a board that exists only inside this panel (signed out, or the
     *  gateway unreachable) — the canvas then persists locally rather than 401ing
     *  on every read. See `src/workspaceSession.ts`. */
    durable?: boolean;
  };
  /** The editor's active colour theme, so the canvas picks the matching palette
   *  (the board declares both itself; `light` is the opt-out). Re-sent on change. */
  colorTheme?: 'light' | 'dark';
  /** The sidebar's active BuilderForce project — injected into the system prompt so
   *  the Brain scopes platform tools to it, and used to scope new chats. */
  project?: { id: number; name: string };
  /** Whether the signed-in user can change project settings (manager) — gates the
   *  Evermind console's write controls (disabled, not hidden). Best-effort from the
   *  host's workspace role; the API enforces authoritatively regardless. */
  canManage?: boolean;
  /** `projectId → name` for every known project, so the header can name the project
   *  an EXISTING chat belongs to (not just the sidebar's active one). Keys are
   *  stringified ids (JSON). Best-effort — an unknown id falls back to "No project". */
  projectNames?: Record<string, string>;
  /** The host's local file tools, forwarded so the model can call them over the bridge. */
  /** Localized UI strings (see {@link LabelBundle}). */
  labels: LabelBundle;
  /** The editor's display language (`vscode.env.language`, e.g. `de`, `zh-cn`) — how
   *  numbers, money and relative times are formatted in the shared components. */
  locale?: string;
  /** The MODEL ROWS' copy (categories, funding lines, Auto/Pool/Evermind naming),
   *  shared verbatim with the host's `Change model` QuickPick so the two pickers
   *  cannot word the same row differently. See `src/modelChoiceLabels.ts`. */
  modelLabels?: ModelChoiceLabels;
  /**
   * The signed-in user's PERSONALITY-only directive block (from the gateway's
   * `/api/limbic/block`), so the chat's tone reflects the user. Injected into the
   * ambient `extraSystem` channel (not baked into the shared persona). Empty/absent
   * when the user has no profile — a no-op. Fetched once per session by the host.
   */
  personalityBlock?: string;
  /** The installed extension's version, so a copied diagnostics report pins the exact
   *  client build it came from (a stale VSIX is a routine cause of "already fixed" bugs). */
  extensionVersion?: string;
  /** Short SOURCE HASH of the installed artifact. A version names a release, not a
   *  build: two VSIXes can carry the same version and different code, so this is the
   *  field a "did you get the fix?" question is actually answerable from. `"dev"` when
   *  the host is running unbundled. See `src/buildInfo.ts`. */
  buildId?: string;
  /** One line on whether this MACHINE can run the POSIX git scripts (`git_sync_latest` /
   *  `git_undo` / `git_redo`), resolved host-side. Carried into the chat diagnostics so
   *  a report of one of those tools failing says whether the guard was even live. */
  posixShell?: string;
  /** ISO timestamp the installed artifact was bundled, or `"dev"` when unbundled. */
  builtAt?: string;
}
