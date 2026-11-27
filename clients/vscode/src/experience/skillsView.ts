import * as vscode from "vscode";
import { makeNonce } from "../panels/webviewBundleShell";
import type { SkillsController } from "./skillsController";
import { renderSkillsHtml } from "./skillsViewHtml";
import type { SkillsInbound, SkillsOutbound } from "./skillsViewProtocol";

/**
 * The "Skills" sidebar view (Teach once, run, schedule, history). A small self-contained
 * webview — no React bundle — whose page is `skillsView*.ts` and whose logic is the
 * {@link SkillsController}. This class only owns the webview's lifecycle: it hands the
 * controller the page's messages and the page the controller's frames.
 */
export class SkillsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "builderforce.skills";
  private view: vscode.WebviewView | undefined;
  private controller: SkillsController | undefined;

  /** Late-bound: the controller posts through this provider, so it cannot exist first. */
  attach(controller: SkillsController): void {
    this.controller = controller;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    // Listener BEFORE html: the page posts `ready` as soon as it boots.
    view.webview.onDidReceiveMessage((m: unknown) => {
      if (isInbound(m)) void this.controller?.handle(m);
    });
    view.webview.html = renderSkillsHtml({ nonce: makeNonce(), title: vscode.l10n.t("Skills") });
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.controller?.push();
    });
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  /** Re-send state (sign-in or a setting changed). No-op while the view is closed. */
  refresh(): void {
    if (this.view) void this.controller?.push();
  }

  /** Deliver one frame to the page; dropped when the view is not open. */
  post(message: SkillsOutbound): void {
    void this.view?.webview.postMessage(message);
  }
}

function isInbound(m: unknown): m is SkillsInbound {
  return !!m && typeof m === "object" && typeof (m as { type?: unknown }).type === "string";
}
