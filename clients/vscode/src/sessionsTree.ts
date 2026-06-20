import * as vscode from "vscode";
import { ChatSession, SessionStore } from "./sessionStore";

/** The sidebar history list (Activity Bar → BuilderForce → Sessions). */
export class SessionsTreeProvider implements vscode.TreeDataProvider<ChatSession> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: SessionStore) {
    store.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(s: ChatSession): vscode.TreeItem {
    const item = new vscode.TreeItem(s.title || "New session", vscode.TreeItemCollapsibleState.None);
    item.id = s.id;
    item.description = relativeTime(s.updatedAt);
    item.iconPath = new vscode.ThemeIcon("comment-discussion");
    item.contextValue = "builderforceSession";
    item.tooltip = s.title;
    item.command = { command: "builderforce.openSession", title: "Open Session", arguments: [s.id] };
    return item;
  }

  getChildren(): ChatSession[] {
    return this.store.list();
  }
}

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
