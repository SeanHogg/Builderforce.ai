import * as vscode from "vscode";
import { BfBrainChat, listBrainChats, listAgentPool } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";
import { getProjectNames, projectLabel } from "./projectNames";

/**
 * The sidebar history list (Activity Bar → BuilderForce → Sessions). Each item is a
 * server-side Brain conversation — the SAME unified `/api/brain` chats the in-editor
 * Brain webview and the web app share. Clicking one opens (or focuses) the Brain
 * panel on that conversation; there is no separate local session store.
 *
 * The list keys off the active project (projectState): with a project selected it shows
 * only that project's chats; with none selected it shows every chat, each labelled with
 * the project it belongs to so the mixed list stays legible.
 */
export class SessionsTreeProvider implements vscode.TreeDataProvider<BfBrainChat> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Short-lived cache so an expand + a refresh storm don't refetch per render.
  private cache: { ts: number; chats: BfBrainChat[] } | undefined;
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
    this.cache = undefined;
    this.poolLoaded = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(chat: BfBrainChat): vscode.TreeItem {
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
    // Multi-party chat: append the participants' initials so a shared session reads
    // at a glance (native TreeItems take only text + one icon, so initials go here).
    const names = (chat.participants ?? []).map((p) => this.agentNames.get(p.ref) || p.ref).filter(Boolean);
    if (names.length > 0) {
      const badge = names.slice(0, 3).map(initials).join(" ");
      const extra = names.length > 3 ? ` +${names.length - 3}` : "";
      description = description ? `${description} · 👥 ${badge}${extra}` : `👥 ${badge}${extra}`;
      item.tooltip = new vscode.MarkdownString(
        `${chat.title}\n\n**${vscode.l10n.t("Participants")}:** ${names.join(", ")}`,
      );
    } else {
      item.tooltip = chat.title;
    }
    item.description = description;
    item.iconPath = new vscode.ThemeIcon("comment-discussion");
    item.contextValue = "builderforceSession";
    item.command = { command: "builderforce.openSession", title: vscode.l10n.t("Open Chat"), arguments: [chat.id] };
    return item;
  }

  async getChildren(): Promise<BfBrainChat[]> {
    if (!(await this.secrets.get(SECRET_KEY))) return [];
    if (!this.cache || Date.now() - this.cache.ts >= SessionsTreeProvider.TTL) {
      this.cache = { ts: Date.now(), chats: await listBrainChats(this.secrets) };
    }

    // Resolve participant names ONCE (and only when a chat has any) — a single
    // stable pool fetch, not a per-row call, so the roster costs no N+1.
    if (!this.poolLoaded && this.cache.chats.some((c) => (c.participants?.length ?? 0) > 0)) {
      this.poolLoaded = true;
      const pool = await listAgentPool(this.secrets);
      this.agentNames = new Map(pool.map((a) => [a.ref, a.name]));
    }

    const project = getSelectedProject();
    this.filtered = !!project;
    if (project) return this.cache.chats.filter((c) => c.projectId === project.id);

    // Unfiltered: resolve project names for the per-row labels (best-effort, cached).
    this.projectNameById = await getProjectNames(this.secrets);
    return this.cache.chats;
  }
}

/** Up to two initials from a display name (e.g. "Bob Developer" → "BD"). */
function initials(name: string): string {
  const words = name.trim().replace(/[()[\]{}]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
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
