import * as vscode from "vscode";
import { BfBrainChat, listBrainChats } from "./bfApi";
import { SECRET_KEY } from "./gateway";

/**
 * The sidebar history list (Activity Bar → BuilderForce → Sessions). Each item is a
 * server-side Brain conversation — the SAME unified `/api/brain` chats the in-editor
 * Brain webview and the web app share. Clicking one opens (or focuses) the Brain
 * panel on that conversation; there is no separate local session store.
 */
export class SessionsTreeProvider implements vscode.TreeDataProvider<BfBrainChat> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Short-lived cache so an expand + a refresh storm don't refetch per render.
  private cache: { ts: number; chats: BfBrainChat[] } | undefined;
  private static readonly TTL = 5_000;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  /** Drop the cache and repaint (call after create / rename / delete / sign-in). */
  refresh(): void {
    this.cache = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(chat: BfBrainChat): vscode.TreeItem {
    const item = new vscode.TreeItem(chat.title || `Chat ${chat.id}`, vscode.TreeItemCollapsibleState.None);
    item.id = String(chat.id);
    item.description = relativeTime(chat.updatedAt);
    item.iconPath = new vscode.ThemeIcon("comment-discussion");
    item.contextValue = "builderforceSession";
    item.tooltip = chat.title;
    item.command = { command: "builderforce.openSession", title: vscode.l10n.t("Open Chat"), arguments: [chat.id] };
    return item;
  }

  async getChildren(): Promise<BfBrainChat[]> {
    if (!(await this.secrets.get(SECRET_KEY))) return [];
    if (this.cache && Date.now() - this.cache.ts < SessionsTreeProvider.TTL) return this.cache.chats;
    const chats = await listBrainChats(this.secrets);
    this.cache = { ts: Date.now(), chats };
    return chats;
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
