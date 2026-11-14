import * as vscode from "vscode";
import { SECRET_KEY } from "./gateway";
import { displayChatProgressPct } from "@builderforce/agent-loop";
import { getSelectedProject, onProjectChange } from "./projectState";
import { projectLabel } from "./projectNames";
import { attentionFor, attentionIcon, attentionDescriptionPrefix } from "./attention";
import { sessionsLibraryGroup, sessionsLibraryRowId, sessionsLibraryRows } from "./sessionsLibrary";
import { appendTicketProgress, conversationAccessibilityName, conversationTreeLabel, ticketProgressTooltipLine, } from "./ticketProgressDisplay";
import { archive as archiveRows, unarchive, partitionArchived, pruneArchive, sweepArchivable } from "./sessionsArchive";
import { SessionsSnapshotStore } from "./sessionsSnapshotStore";
/** globalState keys for archive state and view toggle. */
const ARCHIVE_STATE_KEY = "builderforce.sessions.archive";
const SHOW_ARCHIVED_KEY = "builderforce.sessions.showArchived";
/** The row's open/done ticket counts, localized (`2h · 62% · 3 open · 5 done`). */
const TICKET_COUNT_LABELS = {
    open: (n) => vscode.l10n.t("{n} open", { n }),
    done: (n) => vscode.l10n.t("{n} done", { n }),
};
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
/** Extract the row key from a SessionTreeNode, if it has one. */
export function keyOfSessionNode(node) {
    return node.nodeType === "item" ? node.row.key : undefined;
}
/**
 * The conversation a sidebar row means, or undefined for a board row.
 *
 * The row-level context commands (rename, delete) are handed the tree NODE, and the
 * node stopped being a bare `BfBrainChat` when conversations and boards became one
 * list. Exported so `extension.ts` reads the shape through this module rather than
 * reaching into it — and so a rename silently doing nothing (which is what reading a
 * `.id` that no longer exists would have caused) is impossible to reintroduce.
 */
export function chatOfSessionNode(node) {
    if (!node || typeof node !== "object")
        return undefined;
    const candidate = node;
    if (candidate.nodeType !== "item" || !candidate.row)
        return undefined;
    return candidate.row.source.kind === "chat" ? candidate.row.source.chat : undefined;
}
const NO_NAMES = new Map();
export class SessionsTreeProvider {
    secrets;
    ctx;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    // ONE snapshot for ONE list, read by every group — so expanding all four costs no
    // extra request and the groups cannot disagree about what is newest. The ROWS are
    // derived from it on every paint, so live state (attention, archive) repaints
    // without another request.
    store;
    // Set during getChildren so getTreeItem can decide how to label each row: when the
    // list is unfiltered we show each chat's project; when scoped to one it's implied.
    filtered = false;
    constructor(secrets, ctx) {
        this.secrets = secrets;
        this.ctx = ctx;
        this.store = new SessionsSnapshotStore(secrets);
        // The server's list moved: keep the archive in step with it, then repaint.
        this.store.onDidChange(() => { this.pruneArchive(); this.repaint(); });
        // The active project scopes this list: re-derive the rows now (the filter is local),
        // then revalidate — unscoped rows label each chat with its project name.
        onProjectChange(() => { this.repaint(); this.refresh(); });
        // Load archive state from globalState.
        this._archiveState = this.ctx.globalState.get(ARCHIVE_STATE_KEY, {});
        this._showArchived = this.ctx.globalState.get(SHOW_ARCHIVED_KEY, false);
        // Seed the menu when-clause context so the right toggle icon shows on load.
        void vscode.commands.executeCommand("setContext", SHOW_ARCHIVED_KEY, this._showArchived);
        // Schedule the archive sweep: run once now (on activation) and then daily.
        this.runSweep();
        const sweepInterval = setInterval(() => this.runSweep(), SWEEP_INTERVAL_MS);
        ctx.subscriptions.push({ dispose: () => clearInterval(sweepInterval) }, this.store);
    }
    _archiveState = {};
    get showArchived() { return this._showArchived; }
    _showArchived = false;
    /** Toggle showing archived sessions. */
    setShowArchived(show) {
        this._showArchived = show;
        void this.ctx.globalState.update(SHOW_ARCHIVED_KEY, show);
        void vscode.commands.executeCommand("setContext", SHOW_ARCHIVED_KEY, show);
        this.repaint();
    }
    /**
     * Archive one session by key — SERVER-side, not a local flag.
     *
     * This used to be local-only ("a repaint, not a refetch"), which left the tree
     * claiming a chat was put away while the server still listed it, and made this a
     * second, disagreeing Delete next to the one that already archives server-side.
     * The HTTP write lives in the `builderforce.archiveSession` command, which owns
     * the signed-in context and the error surface; this records the local view so the
     * row repaints immediately and stays consistent if the command cannot run.
     */
    archiveSession(key) {
        this._archiveState = archiveRows(this._archiveState, [key], Date.now(), true);
        this.persistArchive();
        this.repaint();
    }
    /** Unarchive one session by key. */
    unarchiveSession(key) {
        this._archiveState = unarchive(this._archiveState, key);
        this.persistArchive();
        this.repaint();
    }
    /** Run the archive sweep: auto-archive finished sessions older than 5 days. */
    runSweep() {
        const rows = this.unscopedRows();
        if (!rows)
            return;
        const now = Date.now();
        const due = sweepArchivable(rows, this._archiveState, now);
        if (due.length > 0) {
            this._archiveState = archiveRows(this._archiveState, due, now, false);
            this.persistArchive();
        }
    }
    /** Drop archive entries for rows the server no longer returns. Against the UNSCOPED
     *  list — a chat in another project is filtered out of view, not gone. */
    pruneArchive() {
        const rows = this.unscopedRows();
        if (!rows)
            return;
        this._archiveState = pruneArchive(this._archiveState, rows);
        this.persistArchive();
    }
    persistArchive() {
        void this.ctx.globalState.update(ARCHIVE_STATE_KEY, this._archiveState);
    }
    /**
     * Revalidate (call after create / rename / delete / invite / sign-in, or any signal
     * the server's list moved). Throttled: a burst collapses to one request, the painted
     * list stays up while it is in flight, and an unchanged answer repaints nothing.
     */
    refresh() {
        this.store.refresh();
    }
    /** Repaint from the snapshot already held — for LOCAL state the rows are derived
     *  from (live attention, editor-local runs, archive) that costs no request. */
    repaint() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(node) {
        if (node.nodeType === "group") {
            const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
            item.id = `creation-group:${node.kind}`;
            item.contextValue = "builderforceSessionGroup";
            item.iconPath = new vscode.ThemeIcon(node.kind === "running" ? "loading~spin" : node.kind === "pinned" ? "pinned" : node.kind === "shared" ? "organization" : "history");
            return item;
        }
        if (node.row.source.kind === "canvas") {
            const session = node.row.source.session;
            const item = new vscode.TreeItem(session.title || vscode.l10n.t("Untitled Session"), vscode.TreeItemCollapsibleState.None);
            item.id = sessionsLibraryRowId(node.group, node.row);
            item.description = `${relativeTime(session.lastActivityAt)}${session.collaboratorCount && session.collaboratorCount > 1 ? ` · ${vscode.l10n.t("{0} people", session.collaboratorCount)}` : ""}`;
            item.tooltip = new vscode.MarkdownString(`**${session.title}**\n\n${session.pinned ? `${vscode.l10n.t("Pinned")} · ` : ""}${session.unread ? `${vscode.l10n.t("Updated")} · ` : ""}${vscode.l10n.t("{0} revisions", session.revision)}`);
            item.iconPath = new vscode.ThemeIcon(session.preview?.objects?.some((object) => object.status?.toLowerCase() === "running") ? "loading~spin" : session.unread ? "circle-filled" : "multiple-windows");
            item.contextValue = "builderforceCreationSession";
            item.command = { command: "builderforce.openCreationSessionItem", title: vscode.l10n.t("Open Creation Session"), arguments: [session] };
            return item;
        }
        // A conversation. Same panel, opened at its chat surface — which is why this row
        // sits in the same list as the boards rather than under a heading of its own.
        const chat = node.row.source.chat;
        const item = new vscode.TreeItem(conversationTreeLabel(chat), vscode.TreeItemCollapsibleState.None);
        item.id = sessionsLibraryRowId(node.group, node.row);
        const time = relativeTime(chat.updatedAt);
        // Linked-ticket complete percent lives AFTER the relative time in description
        // (`2h · 85%`). Title stays title-only so VS Code ellipsizes the label, not
        // the marker (#2442 / #2439). Absent/non-finite pct omits the suffix; a real
        // 0% still shows.
        const ticketPct = displayChatProgressPct(chat.ticketProgressPct);
        const timeAndPct = appendTicketProgress(time, ticketPct, { open: chat.ticketOpenCount, done: chat.ticketDoneCount }, TICKET_COUNT_LABELS);
        // Filtered: the project is implied by the header, so just show the time. Unfiltered:
        // prefix the project name (or "No project") so a mixed history stays readable.
        let description = timeAndPct;
        if (!this.filtered) {
            const project = projectLabel(this.store.current?.projectNameById ?? NO_NAMES, chat.projectId);
            description = project ? (timeAndPct ? `${project} · ${timeAndPct}` : project) : timeAndPct;
        }
        // Multi-party chat: show the participants as coloured initial avatars. The row
        // ICON becomes a composite avatar (up to two overlapping discs — a native
        // TreeItem takes only one iconPath), and the initials also read in the
        // description text (16px avatars are small), with full names in the tooltip.
        // Agents resolve via the loaded agent-name pool; humans carry their display
        // name inline (kind='human', `name` set server-side) so they never show a raw id.
        const names = (chat.participants ?? [])
            .map((p) => this.store.current?.agentNames.get(p.ref) || p.name || p.ref)
            .filter(Boolean);
        if (names.length > 0) {
            const badge = names.slice(0, 3).map(initials).join(" ");
            const extra = names.length > 3 ? ` +${names.length - 3}` : "";
            description = description ? `${description} · ${badge}${extra}` : `${badge}${extra}`;
            item.iconPath = participantAvatarUri(names);
            item.tooltip = new vscode.MarkdownString(`${chat.title}\n\n**${vscode.l10n.t("Participants")}:** ${names.join(", ")}`);
        }
        else {
            item.iconPath = new vscode.ThemeIcon("comment-discussion");
            item.tooltip = chat.title;
        }
        // Live state wins the icon slot: a running or question-blocked session should
        // read at a glance while the user multitasks across many open sessions. The
        // participant initials stay in the description, so no roster context is lost.
        const attn = attentionFor("chat", chat.id);
        if (attn) {
            item.iconPath = attentionIcon(attn);
            description = `${attentionDescriptionPrefix(attn)}${description}`;
            const state = attn === "awaiting_input"
                ? vscode.l10n.t("Waiting on your answer")
                : vscode.l10n.t("Agent is working…");
            item.tooltip = new vscode.MarkdownString(`${chat.title}\n\n**${state}**`);
        }
        if (ticketPct != null) {
            // Tooltip is the only place extra wording ("ticket progress") appears.
            const progressLine = ticketProgressTooltipLine(ticketPct);
            if (item.tooltip instanceof vscode.MarkdownString) {
                item.tooltip.appendMarkdown(`\n\n${progressLine}`);
            }
            else {
                const base = typeof item.tooltip === "string" && item.tooltip.length > 0
                    ? item.tooltip
                    : conversationTreeLabel(chat);
                item.tooltip = `${base}\n${progressLine}`;
            }
        }
        item.accessibilityInformation = {
            label: conversationAccessibilityName(conversationTreeLabel(chat), time, ticketPct),
        };
        item.description = description;
        item.contextValue = "builderforceSession";
        item.command = { command: "builderforce.openSession", title: vscode.l10n.t("Open Chat"), arguments: [chat.id, { title: chat.title, projectId: chat.projectId, ownerId: chat.ownerId ?? null }] };
        return item;
    }
    async getChildren(element) {
        if (!(await this.secrets.get(SECRET_KEY)))
            return [];
        if (!element) {
            // FACETS of one list, not sources. "Recent" is the list; the other three are
            // readings of it. There is no "Chats" group: a conversation is a row in the
            // same list, because it opens the same panel (see the module header).
            const groups = [
                { nodeType: "group", kind: "all", label: vscode.l10n.t("Recent") },
                { nodeType: "group", kind: "pinned", label: vscode.l10n.t("Pinned") },
                { nodeType: "group", kind: "shared", label: vscode.l10n.t("Shared") },
                { nodeType: "group", kind: "running", label: vscode.l10n.t("Running") },
            ];
            // Show "Archived" group when the user has toggled it on.
            if (this.showArchived) {
                groups.push({ nodeType: "group", kind: "archived", label: vscode.l10n.t("Archived") });
            }
            return groups;
        }
        if (element.nodeType !== "group")
            return [];
        const rows = this.scopedRows(await this.store.get());
        // Partition into active and archived, then show the right slice per group.
        const { active, archived } = partitionArchived(rows, this._archiveState);
        const pool = element.kind === "archived" ? archived : active;
        return sessionsLibraryGroup(pool, element.kind === "archived" ? "all" : element.kind).map((row) => ({
            nodeType: "item",
            group: element.kind,
            row,
        }));
    }
    /**
     * The rows the tree shows, derived from the snapshot on every paint — cheap, and it
     * is what lets live state (a run starting, an archive) repaint without a request.
     */
    scopedRows(snapshot) {
        // The active project scopes the CONVERSATIONS, as it always has. Boards are not
        // scoped by it: a canvas carries its project links on its cards rather than in one
        // column, so filtering them on a single id would hide boards that do belong.
        const project = getSelectedProject();
        this.filtered = !!project;
        const scopedChats = project ? snapshot.chats.filter((c) => c.projectId === project.id) : snapshot.chats;
        return sessionsLibraryRows({
            sessions: snapshot.sessions,
            chats: scopedChats,
            // "Running" means the same thing for a conversation as for a board. The host
            // already polls this (`attentionFor`); passing it in is what keeps the list
            // builder pure.
            runningChatIds: new Set(scopedChats.filter((c) => attentionFor("chat", c.id) === "running").map((c) => c.id)),
        });
    }
    /** Every row the account has, regardless of project — what archive upkeep reads. */
    unscopedRows() {
        const snapshot = this.store.current;
        if (!snapshot)
            return undefined;
        return sessionsLibraryRows({ sessions: snapshot.sessions, chats: snapshot.chats });
    }
}
/** Up to two initials from a display name (e.g. "Bob Developer" → "BD"). */
function initials(name) {
    const words = name.trim().replace(/[()[\]{}]/g, " ").split(/\s+/).filter(Boolean);
    if (words.length === 0)
        return "?";
    if (words.length === 1)
        return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}
// KEEP IN SYNC with brain-ui `avatarColor` (packages/brain-ui/src/ParticipantBadge.tsx)
// so the same participant is the same hue in the tree, the composer chip and the
// transcript badge. WCAG-friendly discs; white text sits at ≥4.5:1 on each.
const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#0891b2", "#059669", "#4f46e5"];
function avatarColor(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++)
        h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function esc(s) {
    return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}
/**
 * A composite avatar icon for a session row: up to two overlapping coloured discs
 * with each participant's first initial (a native TreeItem takes only ONE icon).
 * Returned as a `data:` SVG URI — the tree's supported way to render a custom icon.
 */
function participantAvatarUri(names) {
    const first = names.slice(0, 2);
    const R = 8; // 16x16 canvas
    const discs = first.map((name, i) => {
        // One disc → centred; two → offset so they overlap (back one first for z-order).
        const cx = first.length === 1 ? 8 : i === 0 ? 6 : 10;
        const glyph = esc(initials(name).slice(0, 1));
        return (`<circle cx="${cx}" cy="8" r="${R - (first.length > 1 ? 0.5 : 0)}" fill="${avatarColor(name)}" stroke="#00000022" stroke-width="0.5"/>` +
            `<text x="${cx}" y="11.2" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="8" font-weight="700" fill="#ffffff" text-anchor="middle">${glyph}</text>`);
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${discs.join("")}</svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}
function relativeTime(iso) {
    if (!iso)
        return "";
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts))
        return "";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)
        return vscode.l10n.t("now");
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24)
        return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}
//# sourceMappingURL=sessionsTree.js.map