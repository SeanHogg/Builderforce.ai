import * as vscode from "vscode";
import { getAttention } from "./bfApi";
import { getSelectedProject } from "./projectState";
import { createRefreshCoalescer } from "./refreshCoalescer";
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
let current = { tasks: {}, chats: {}, counts: { running: 0, awaiting: 0 }, manager: { lastRunAt: null, recentlyActive: false } };
/** The AI Manager's cadence from the latest poll (tenant-wide / selected project) —
 *  drives the ambient "Manager active / last managed" status bar item. */
export function managerAttention() {
    return current.manager ?? { lastRunAt: null, recentlyActive: false };
}
const localBySource = new Map();
const _onLocalRunsChange = new vscode.EventEmitter();
/** Fires when the webview-local run set changes (subscribe to repaint the trees). */
export const onLocalRunsChange = _onLocalRunsChange.event;
/** Pick the most attention-worthy of several states (a needed answer beats a
 *  running loop, which beats idle). Shared so server + local states merge one way. */
function strongestState(...states) {
    if (states.includes("awaiting_input"))
        return "awaiting_input";
    if (states.includes("running"))
        return "running";
    return undefined;
}
/** Replace ONE source's editor-local run set (LOCAL chat ids the host-owned Brain loop
 *  is running / paused on — runs the server cannot see — and each one's bound server
 *  chat id). Pass an empty set to retire a source. Fires {@link onLocalRunsChange} only
 *  when that source's set changes. */
export function setLocalChatRuns(sourceId, runs, serverIds = new Map()) {
    const next = new Map();
    for (const id of runs.running)
        next.set(id, "running");
    // Awaiting wins over running for the same id — it's the state the user must act on.
    for (const id of runs.awaiting)
        next.set(id, "awaiting_input");
    const prev = localBySource.get(sourceId);
    const same = (a, b) => a.size === (b?.size ?? 0) && [...a].every(([k, v]) => b?.get(k) === v);
    if (same(next, prev?.states) && same(serverIds, prev?.serverIds))
        return;
    // An empty report retires the bucket outright, so a closed panel leaves nothing behind.
    if (next.size === 0)
        localBySource.delete(sourceId);
    else
        localBySource.set(sourceId, { states: next, serverIds });
    _onLocalRunsChange.fire();
}
/** The strongest editor-local run state of a LOCAL chat — the panel's own tab. */
export function editorChatState(localId) {
    let out;
    for (const bucket of localBySource.values())
        out = strongestState(out, bucket.states.get(localId));
    return out;
}
/** The strongest editor-local run state of the local chats bound to a SERVER chat. */
function localStateOfServerChat(serverId) {
    let out;
    for (const bucket of localBySource.values()) {
        for (const [localId, state] of bucket.states) {
            if (bucket.serverIds.get(localId) === serverId)
                out = strongestState(out, state);
        }
    }
    return out;
}
/** The live state of a task or SERVER Brain chat, or undefined when idle. Merges the
 *  server attention map with the editor-local run overlay (chats only). */
export function attentionFor(kind, id) {
    const server = (kind === "task" ? current.tasks[id] : current.chats[id])?.state;
    const local = kind === "chat" ? localStateOfServerChat(id) : undefined;
    return strongestState(server, local);
}
/** The pending-question approval id for a task, when it is awaiting an answer
 *  (lets a row deep-link the human straight to the question). */
export function attentionApprovalId(kind, id) {
    const item = kind === "task" ? current.tasks[id] : current.chats[id];
    return item?.approvalId;
}
/** Colored status icon for a live row. `running` → blue spinner; `awaiting_input`
 *  → amber unresolved-comment (matches the Inbox's pending-question glyph). */
export function attentionIcon(state) {
    return state === "awaiting_input"
        ? new vscode.ThemeIcon("comment-unresolved", new vscode.ThemeColor("list.warningForeground"))
        : new vscode.ThemeIcon("loading~spin", new vscode.ThemeColor("charts.blue"));
}
/** A short description-prefix glyph so the state still reads without colour
 *  (accessibility + when the status icon slot is taken by an avatar). `running`
 *  is conveyed by its spinner icon, so only `awaiting_input` gets a glyph. */
export function attentionDescriptionPrefix(state) {
    return state === "awaiting_input" ? "❓ " : "";
}
/**
 * Title-prefix glyph for a per-session chat TAB. A `WebviewPanel.iconPath` takes only
 * a Uri — never a ThemeIcon — so a tab cannot host the tree's animated `loading~spin`
 * codicon. Running therefore needs its OWN glyph here, unlike
 * {@link attentionDescriptionPrefix} (whose row already carries the spinner icon).
 * Idle returns '' so the tab reads as just the chat title.
 */
export function sessionTabPrefix(state) {
    return state === "awaiting_input" ? "❓ " : state === "running" ? "⏳ " : "";
}
/** Tab icon for a per-session chat panel — the static-PNG counterpart to
 *  {@link attentionIcon} (see {@link sessionTabPrefix} for why a tab can't use a
 *  ThemeIcon). Idle falls back to the extension's own mark. */
export function sessionTabIcon(extensionUri, state) {
    const file = state === "awaiting_input" ? "session-question.png" : state === "running" ? "session-running.png" : "icon.png";
    return vscode.Uri.joinPath(extensionUri, "media", file);
}
/**
 * Adaptive poller for the attention map. Fast while anything is live, lazy when
 * idle, slower still while the window is not focused, and backing off after a
 * failed fetch — the trees are lightweight, and this is the only recurring signal
 * that makes them feel live (they otherwise repaint only on explicit refresh).
 * Fires {@link onDidChange} only when the map actually changes, so subscribers
 * (the trees) don't repaint every tick for nothing.
 */
export class AttentionPoller {
    secrets;
    _onDidChange = new vscode.EventEmitter();
    onDidChange = this._onDidChange.event;
    timer = null;
    focusSub = null;
    disposed = false;
    lastKey = "";
    /** Current wait after a failed fetch; 0 while the gateway answers. */
    errorMs = 0;
    // Every tick is a request the platform has to serve. Timer ticks read the server's
    // CACHED snapshot; only an explicit refresh (a platform write, sign-in, coming back to
    // the window) asks for a fresh one — so an editor left open no longer keeps the
    // database awake. The cadences below are what "live enough" costs, not a guess.
    static FAST_MS = 10_000;
    static IDLE_MS = 60_000;
    /** Not focused, or focused but nobody has touched it lately (`WindowState.active`):
     *  nobody is reading the trees, so they can wait. */
    static BACKGROUND_MS = 5 * 60_000;
    /** A focus/activity change refreshes at most this often — `active` flips a lot. */
    static REFRESH_MIN_GAP_MS = 30_000;
    lastFetchAt = 0;
    /** After a failed fetch: the first retry, and the ceiling the wait doubles up to
     *  — the same ladder `insights.ts` climbs down when its stream drops. */
    static ERROR_MIN_MS = 15_000;
    static ERROR_MAX_MS = 5 * 60_000;
    /** Fresh refetches collapse: an agent run's burst of platform writes each asks for
     *  one, and every one of them skips the server cache. */
    static REFRESH_WINDOW_MS = 2_000;
    fresh = createRefreshCoalescer(() => this.tick(true), AttentionPoller.REFRESH_WINDOW_MS);
    constructor(secrets) {
        this.secrets = secrets;
    }
    start() {
        // Regaining focus is the moment a stale tree gets noticed — refetch right then,
        // and let the unfocused cadence take over again when the window is left.
        this.focusSub = vscode.window.onDidChangeWindowState((state) => {
            if (state.focused && state.active && Date.now() - this.lastFetchAt >= AttentionPoller.REFRESH_MIN_GAP_MS) {
                this.refresh();
            }
        });
        void this.tick(false);
    }
    /** Force a FRESH refetch (e.g. after a platform write or sign-in) — the one read
     *  that skips the server cache, because the caller knows state moved. Immediate when
     *  isolated; a burst inside the window becomes one trailing fetch. */
    refresh() {
        this.fresh.request();
    }
    async tick(fresh = false) {
        if (this.disposed)
            return;
        const project = getSelectedProject();
        this.lastFetchAt = Date.now();
        const next = await getAttention(this.secrets, project?.id, fresh);
        if (this.disposed)
            return;
        if (!next) {
            // Unreachable (offline, a deploy, a dead session): keep the last map on the
            // trees and widen the wait. Polling a dead endpoint every eight seconds is
            // what this poller used to do for as long as the editor stayed open.
            this.errorMs = this.errorMs === 0
                ? AttentionPoller.ERROR_MIN_MS
                : Math.min(this.errorMs * 2, AttentionPoller.ERROR_MAX_MS);
            this.schedule(this.errorMs);
            return;
        }
        this.errorMs = 0;
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
        const live = next.counts.running + next.counts.awaiting > 0;
        const { focused, active } = vscode.window.state;
        const attended = focused && active;
        this.schedule(!attended ? AttentionPoller.BACKGROUND_MS : live ? AttentionPoller.FAST_MS : AttentionPoller.IDLE_MS);
    }
    schedule(ms) {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.tick(), ms);
    }
    dispose() {
        this.disposed = true;
        this.fresh.dispose();
        if (this.timer)
            clearTimeout(this.timer);
        this.focusSub?.dispose();
        this._onDidChange.dispose();
    }
}
//# sourceMappingURL=attention.js.map