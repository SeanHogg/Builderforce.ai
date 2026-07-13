import * as vscode from "vscode";
import { BfAttention, BfAttentionManager, BfAttentionState, getAttention } from "./bfApi";
import { getSelectedProject } from "./projectState";

/**
 * The extension's single source of truth for cross-surface "what's live / what
 * needs me" state. One poller fetches `GET /api/runtime/attention` and every tree
 * (Sessions, Projects & Tasks) reads the SAME map via {@link attentionFor}, so a
 * session's status stays in lockstep with the web app and the board — switching
 * sessions in the editor never changes whether the agent keeps executing.
 *
 * States (see bfApi): `running` (actively executing) and `awaiting_input` (paused
 * on ask_human — a person must answer). The visual mapping lives here too
 * ({@link attentionIcon} / {@link attentionDescriptionPrefix}) so both trees agree.
 */

let current: BfAttention = { tasks: {}, chats: {}, counts: { running: 0, awaiting: 0 }, manager: { lastRunAt: null, recentlyActive: false } };

/** The AI Manager's cadence from the latest poll (tenant-wide / selected project) —
 *  drives the ambient "Manager active / last managed" status bar item. */
export function managerAttention(): BfAttentionManager {
  return current.manager ?? { lastRunAt: null, recentlyActive: false };
}

/**
 * Webview-local run overlay. The in-editor Brain's agent loop runs INSIDE the
 * webview (it streams straight to the gateway), so the server-side attention
 * endpoint never sees it — a chat you kick off in the editor and then switch away
 * from keeps executing but wouldn't otherwise light up in the Sessions tree. The
 * Brain webview reports which of its chats are executing / paused on a confirm via
 * {@link setLocalChatRuns}, and {@link attentionFor} merges them, so those chats
 * get the same live indicators as server-tracked (cloud / on-prem) runs. Keyed by
 * chat id; `awaiting_input` = paused on a human confirm (the actionable state).
 */
const localChats = new Map<number, BfAttentionState>();
const _onLocalRunsChange = new vscode.EventEmitter<void>();
/** Fires when the webview-local run set changes (subscribe to repaint the trees). */
export const onLocalRunsChange = _onLocalRunsChange.event;

/** Pick the most attention-worthy of several states (a needed answer beats a
 *  running loop, which beats idle). Shared so server + local states merge one way. */
function strongestState(...states: Array<BfAttentionState | undefined>): BfAttentionState | undefined {
  if (states.includes("awaiting_input")) return "awaiting_input";
  if (states.includes("running")) return "running";
  return undefined;
}

/** Replace the webview-local run set (chat ids the editor Brain loop is running /
 *  paused on). Fires {@link onLocalRunsChange} only when the surfaced set changes. */
export function setLocalChatRuns(runs: { running: number[]; awaiting: number[] }): void {
  const next = new Map<number, BfAttentionState>();
  for (const id of runs.running) next.set(id, "running");
  // Awaiting wins over running for the same id — it's the state the user must act on.
  for (const id of runs.awaiting) next.set(id, "awaiting_input");
  if (next.size === localChats.size && [...next].every(([k, v]) => localChats.get(k) === v)) return;
  localChats.clear();
  for (const [k, v] of next) localChats.set(k, v);
  _onLocalRunsChange.fire();
}

/** The live state of a task or Brain chat, or undefined when idle. Merges the
 *  server attention map with the webview-local run overlay (chats only). */
export function attentionFor(kind: "task" | "chat", id: number): BfAttentionState | undefined {
  const server = (kind === "task" ? current.tasks[id] : current.chats[id])?.state;
  const local = kind === "chat" ? localChats.get(id) : undefined;
  return strongestState(server, local);
}

/** The pending-question approval id for a task, when it is awaiting an answer
 *  (lets a row deep-link the human straight to the question). */
export function attentionApprovalId(kind: "task" | "chat", id: number): string | undefined {
  const item = kind === "task" ? current.tasks[id] : current.chats[id];
  return item?.approvalId;
}

/** Colored status icon for a live row. `running` → blue spinner; `awaiting_input`
 *  → amber unresolved-comment (matches the Inbox's pending-question glyph). */
export function attentionIcon(state: BfAttentionState): vscode.ThemeIcon {
  return state === "awaiting_input"
    ? new vscode.ThemeIcon("comment-unresolved", new vscode.ThemeColor("list.warningForeground"))
    : new vscode.ThemeIcon("loading~spin", new vscode.ThemeColor("charts.blue"));
}

/** A short description-prefix glyph so the state still reads without colour
 *  (accessibility + when the status icon slot is taken by an avatar). `running`
 *  is conveyed by its spinner icon, so only `awaiting_input` gets a glyph. */
export function attentionDescriptionPrefix(state: BfAttentionState): string {
  return state === "awaiting_input" ? "❓ " : "";
}

/**
 * Adaptive poller for the attention map. Fast while anything is live, lazy when
 * idle — the trees are lightweight, and this is the only recurring signal that
 * makes them feel live (they otherwise repaint only on explicit refresh). Fires
 * {@link onDidChange} only when the map actually changes, so subscribers (the
 * trees) don't repaint every tick for nothing.
 */
export class AttentionPoller implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lastKey = "";

  private static readonly FAST_MS = 8_000;
  private static readonly IDLE_MS = 30_000;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  start(): void {
    void this.tick();
  }

  /** Force an immediate refetch (e.g. after a platform write or sign-in). */
  refresh(): void {
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;
    const project = getSelectedProject();
    const next = await getAttention(this.secrets, project?.id);
    if (this.disposed) return;

    current = next;
    // Only repaint when the surfaced state changed — a stable key of every
    // live item so an unchanged poll costs zero tree work.
    const key = JSON.stringify({
      t: Object.entries(next.tasks).map(([k, v]) => `${k}:${v.state}:${v.approvalId ?? ""}`).sort(),
      c: Object.entries(next.chats).map(([k, v]) => `${k}:${v.state}:${v.approvalId ?? ""}`).sort(),
      // Include manager cadence so the status bar repaints when a pass lands / ages out.
      m: `${next.manager?.recentlyActive ? 1 : 0}:${next.manager?.lastRunAt ?? ""}`,
    });
    if (key !== this.lastKey) {
      this.lastKey = key;
      this._onDidChange.fire();
    }

    const active = next.counts.running + next.counts.awaiting > 0;
    this.schedule(active ? AttentionPoller.FAST_MS : AttentionPoller.IDLE_MS);
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this._onDidChange.dispose();
  }
}
