import * as vscode from "vscode";
import { BfBrainChat, listBrainChats, listProjects } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";

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
  private projectCache: { ts: number; byId: Map<number, string> } | undefined;
  private static readonly PROJECT_TTL = 60_000;

  constructor(private readonly secrets: vscode.SecretStorage) {
    // The active project scopes this list — repaint when it changes.
    onProjectChange(() => this.refresh());
  }

  /** Drop the cache and repaint (call after create / rename / delete / sign-in). */
  refresh(): void {
    this.cache = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(chat: BfBrainChat): vscode.TreeItem {
    const item = new vscode.TreeItem(chat.title || `Chat ${chat.id}`, vscode.TreeItemCollapsibleState.None);
    item.id = String(chat.id);
    const time = relativeTime(chat.updatedAt);
    // Filtered: the project is implied by the header, so just show the time. Unfiltered:
    // prefix the project name (or "No project") so a mixed history stays readable.
    if (this.filtered) {
      item.description = time;
    } else {
      const project =
        chat.projectId != null ? this.projectNameById.get(chat.projectId) : vscode.l10n.t("No project");
      item.description = project ? (time ? `${project} · ${time}` : project) : time;
    }
    item.iconPath = new vscode.ThemeIcon("comment-discussion");
    item.contextValue = "builderforceSession";
    item.tooltip = chat.title;
    item.command = { command: "builderforce.openSession", title: vscode.l10n.t("Open Chat"), arguments: [chat.id] };
    return item;
  }

  async getChildren(): Promise<BfBrainChat[]> {
    if (!(await this.secrets.get(SECRET_KEY))) return [];
    if (!this.cache || Date.now() - this.cache.ts >= SessionsTreeProvider.TTL) {
      this.cache = { ts: Date.now(), chats: await listBrainChats(this.secrets) };
    }

    const project = getSelectedProject();
    this.filtered = !!project;
    if (project) return this.cache.chats.filter((c) => c.projectId === project.id);

    // Unfiltered: resolve project names for the per-row labels (best-effort, cached).
    this.projectNameById = await this.loadProjectNames();
    return this.cache.chats;
  }

  /** projectId → name, for labelling chats when the list spans every project. */
  private async loadProjectNames(): Promise<Map<number, string>> {
    if (this.projectCache && Date.now() - this.projectCache.ts < SessionsTreeProvider.PROJECT_TTL) {
      return this.projectCache.byId;
    }
    const byId = new Map<number, string>();
    try {
      for (const p of await listProjects(this.secrets)) byId.set(p.id, p.name);
    } catch {
      /* names are best-effort — a chat just falls back to showing only its time */
    }
    this.projectCache = { ts: Date.now(), byId };
    return byId;
  }
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
