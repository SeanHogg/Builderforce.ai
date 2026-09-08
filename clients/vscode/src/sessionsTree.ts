import * as vscode from "vscode";
import { BfBrainChat, listBrainChats, listAgentPool, listCreationSessions } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";
import { getProjectNames, projectLabel } from "./projectNames";
import { attentionFor, attentionIcon, attentionDescriptionPrefix } from "./attention";
import { sessionsLibraryGroup, sessionsLibraryRows, type SessionsLibraryGroup, type SessionsLibraryRow } from "./sessionsLibrary";

/**
 * The sidebar list (Activity Bar → BuilderForce → Sessions): everything this
 * workspace has made, in ONE recency-ordered list.
 *
 * ── WHY THERE IS NO LONGER A "CHATS" GROUP ───────────────────────────────────
 * There used to be five groups — Recent Creation Sessions, Pinned, Shared, Running,
 * and Chats. Four of those are facets of one list. The fifth was a different SOURCE
 * with its own row shape and its own command, sitting as a peer of the other four,
 * which said a conversation and a board were different kinds of place.
 *
 * They are not, and since the panel merge they are not even different DESTINATIONS:
 * both rows reveal the same panel (`BuilderForcePanel`) and differ only in the
 * surface it opens at — chat for a conversation, the board for a canvas. So the kind
 * is a property of a row, the groups are facets, and which rows exist is decided by
 * `sessionsLibrary.ts` using the SAME ordering and dedupe rules the web's `/create`
 * library uses. A chat a board already holds a card for gets no row of its own.
 *
 * The list keys off the active project (projectState): with a project selected it
 * shows only that project's work; with none selected it shows everything, each
 * conversation labelled with the project it belongs to so the mixed list stays
 * legible.
 */
type CreationGroup = { nodeType: "group"; kind: SessionsLibraryGroup; label: string };
type CreationItem = { nodeType: "item"; row: SessionsLibraryRow };
export type SessionTreeNode = CreationGroup | CreationItem;

/**
 * The conversation a sidebar row means, or undefined for a board row.
 *
 * The row-level context commands (rename, delete) are handed the tree NODE, and the
 * node stopped being a bare `BfBrainChat` when conversations and boards became one
 * list. Exported so `extension.ts` reads the shape through this module rather than
 * reaching into it — and so a rename silently doing nothing (which is what reading a
 * `.id` that no longer exists would have caused) is impossible to reintroduce.
 */
export function chatOfSessionNode(node: unknown): BfBrainChat | undefined {
  if (!node || typeof node !== "object") return undefined;
  const candidate = node as Partial<CreationItem>;
  if (candidate.nodeType !== "item" || !candidate.row) return undefined;
  return candidate.row.source.kind === "chat" ? candidate.row.source.chat : undefined;
}

export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // ONE short-lived cache for ONE list, so expanding all four groups is two requests
  // rather than eight — and so the four groups cannot disagree about what is newest.
  private rowCache: { ts: number; rows: SessionsLibraryRow[] } | undefined;
  private static readonly TTL = 5_000;

  // Set during getChildren so getTreeItem can decide how to label each row: when the
  // list is unfiltered we show each chat's project; when scoped to one it's implied.
  private filtered = false;
  private projectNameById = new Map<number, string>();
  // Participant ref → display name, resolved from the (stable) tenant agent pool.
  // Loaded once per refresh, and only when some chat actually has participants.
  private agentNames = new Map<string, string>();
  private poolLoaded = false;

  constructor(private readonly secrets: vscode.SecretStorage) {
    // The active project scopes this list — repaint when it changes.
    onProjectChange(() => this.refresh());
  }

  /** Drop the cache and repaint (call after create / rename / delete / invite / sign-in). */
  refresh(): void {
    this.rowCache = undefined;
    this.poolLoaded = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: SessionTreeNode): vscode.TreeItem {
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
      item.id = `creation:${session.id}`;
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
    const item = new vscode.TreeItem(chat.title || `Chat ${chat.id}`, vscode.TreeItemCollapsibleState.None);
    item.id = String(chat.id);
    const time = relativeTime(chat.updatedAt);
    // Filtered: the project is implied by the header, so just show the time. Unfiltered:
    // prefix the project name (or "No project") so a mixed history stays readable.
    let description = time;
    if (!this.filtered) {
      const project = projectLabel(this.projectNameById, chat.projectId);
      description = project ? (time ? `${project} · ${time}` : project) : time;
    }
    // Multi-party chat: show the participants as coloured initial avatars. The row
    // ICON becomes a composite avatar (up to two overlapping discs — a native
    // TreeItem takes only one iconPath), and the initials also read in the
    // description text (16px avatars are small), with full names in the tooltip.
    // Agents resolve via the loaded agent-name pool; humans carry their display
    // name inline (kind='human', `name` set server-side) so they never show a raw id.
    const names = (chat.participants ?? [])
      .map((p) => this.agentNames.get(p.ref) || (p as { name?: string }).name || p.ref)
      .filter(Boolean);
    if (names.length > 0) {
      const badge = names.slice(0, 3).map(initials).join(" ");
      const extra = names.length > 3 ? ` +${names.length - 3}` : "";
      description = description ? `${description} · ${badge}${extra}` : `${badge}${extra}`;
      item.iconPath = participantAvatarUri(names);
      item.tooltip = new vscode.MarkdownString(
        `${chat.title}\n\n**${vscode.l10n.t("Participants")}:** ${names.join(", ")}`,
      );
    } else {
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
    item.description = description;
    item.contextValue = "builderforceSession";
    item.command = { command: "builderforce.openSession", title: vscode.l10n.t("Open Chat"), arguments: [chat.id] };
    return item;
  }

  async getChildren(element?: SessionTreeNode): Promise<SessionTreeNode[]> {
    if (!(await this.secrets.get(SECRET_KEY))) return [];
    if (!element) {
      // FACETS of one list, not sources. "Recent" is the list; the other three are
      // readings of it. There is no "Chats" group: a conversation is a row in the
      // same list, because it opens the same panel (see the module header).
      return [
        { nodeType: "group", kind: "all", label: vscode.l10n.t("Recent") },
        { nodeType: "group", kind: "pinned", label: vscode.l10n.t("Pinned") },
        { nodeType: "group", kind: "shared", label: vscode.l10n.t("Shared") },
        { nodeType: "group", kind: "running", label: vscode.l10n.t("Running") },
      ];
    }
    if (element.nodeType !== "group") return [];

    const rows = await this.rows();
    return sessionsLibraryGroup(rows, element.kind).map((row) => ({ nodeType: "item" as const, row }));
  }

  /**
   * The whole list, built once per refresh and shared by all four groups.
   *
   * Built ONCE on purpose: the groups are four readings of one list, so fetching per
   * group would be the same two requests four times over — and worse, four lists that
   * could disagree about what is newest if a write landed between them.
   */
  private async rows(): Promise<SessionsLibraryRow[]> {
    if (this.rowCache && Date.now() - this.rowCache.ts < SessionsTreeProvider.TTL) return this.rowCache.rows;

    const [sessions, chats] = await Promise.all([
      listCreationSessions(this.secrets),
      listBrainChats(this.secrets),
    ]);

    // Resolve participant names ONCE (and only when a chat has any) — a single stable
    // pool fetch, not a per-row call, so the roster costs no N+1.
    if (!this.poolLoaded && chats.some((c) => (c.participants?.length ?? 0) > 0)) {
      this.poolLoaded = true;
      const pool = await listAgentPool(this.secrets);
      this.agentNames = new Map(pool.map((a) => [a.ref, a.name]));
    }

    // The active project scopes the CONVERSATIONS, as it always has. Boards are not
    // scoped by it: a canvas carries its project links on its cards rather than in one
    // column, so filtering them on a single id would hide boards that do belong.
    const project = getSelectedProject();
    this.filtered = !!project;
    const scopedChats = project ? chats.filter((c) => c.projectId === project.id) : chats;
    // Unfiltered: resolve project names for the per-row labels (best-effort, cached).
    if (!project) this.projectNameById = await getProjectNames(this.secrets);

    const rows = sessionsLibraryRows({
      sessions,
      chats: scopedChats,
      // "Running" means the same thing for a conversation as for a board. The host
      // already polls this (`attentionFor`); passing it in is what keeps the list
      // builder pure.
      runningChatIds: new Set(scopedChats.filter((c) => attentionFor("chat", c.id) === "running").map((c) => c.id)),
    });
    this.rowCache = { ts: Date.now(), rows };
    return rows;
  }
}

/** Up to two initials from a display name (e.g. "Bob Developer" → "BD"). */
function initials(name: string): string {
  const words = name.trim().replace(/[()[\]{}]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// KEEP IN SYNC with brain-ui `avatarColor` (packages/brain-ui/src/ParticipantBadge.tsx)
// so the same participant is the same hue in the tree, the composer chip and the
// transcript badge. WCAG-friendly discs; white text sits at ≥4.5:1 on each.
const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#0891b2", "#059669", "#4f46e5"];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

/**
 * A composite avatar icon for a session row: up to two overlapping coloured discs
 * with each participant's first initial (a native TreeItem takes only ONE icon).
 * Returned as a `data:` SVG URI — the tree's supported way to render a custom icon.
 */
function participantAvatarUri(names: string[]): vscode.Uri {
  const first = names.slice(0, 2);
  const R = 8; // 16x16 canvas
  const discs = first.map((name, i) => {
    // One disc → centred; two → offset so they overlap (back one first for z-order).
    const cx = first.length === 1 ? 8 : i === 0 ? 6 : 10;
    const glyph = esc(initials(name).slice(0, 1));
    return (
      `<circle cx="${cx}" cy="8" r="${R - (first.length > 1 ? 0.5 : 0)}" fill="${avatarColor(name)}" stroke="#00000022" stroke-width="0.5"/>` +
      `<text x="${cx}" y="11.2" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="8" font-weight="700" fill="#ffffff" text-anchor="middle">${glyph}</text>`
    );
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${discs.join("")}</svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return vscode.l10n.t("now");
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
