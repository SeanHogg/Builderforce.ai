import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebviewPanelBase, type WebviewInbound } from './webviewShared';
import { getBaseUrl, SECRET_KEY } from './gateway';
import { getTenantJwt, type BfProjectDiagnostic } from './bfApi';
import { authLabels } from './authLabels';

interface AuditInbound extends WebviewInbound { location?: { path?: string; startLine?: number }; commit?: string }
const execFileAsync = promisify(execFile);
/** Hosts the same analyzer renderer as Web, with a fenced editor-navigation adapter. */
export class AuditResultsPanel extends WebviewPanelBase<AuditInbound> {
  private readonly root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  static open(ctx: vscode.ExtensionContext, result: NonNullable<BfProjectDiagnostic['result']>): void { new AuditResultsPanel(ctx, result); }
  private constructor(ctx: vscode.ExtensionContext, private readonly result: NonNullable<BfProjectDiagnostic['result']>) {
    super(ctx, { viewType: 'builderforce.auditResults', title: vscode.l10n.t('BuilderForce Visualization'), htmlTitle: 'BuilderForce Visualization' });
    this.panel.reveal(vscode.ViewColumn.Beside);
  }
  protected onDispose(): void {}
  protected async onMessage(message: AuditInbound): Promise<void> {
    if (message.type === 'ready') {
      this.post({ type: 'init', view: 'audit-result', baseUrl: getBaseUrl(), signedIn: !!(await this.ctx.secrets.get(SECRET_KEY)),
        token: await getTenantJwt(this.ctx.secrets), labels: { ...authLabels(), 'canvas.locale': vscode.env.language }, auditResult: this.result });
    }
    if (message.type === 'audit.source' && this.root && typeof message.location?.path === 'string') {
      try {
        const root = await realpath(this.root);
        const requested = resolve(root, message.location.path);
        const target = message.commit ? requested : await realpath(requested);
        const distance = relative(root, target);
        if (isAbsolute(distance) || distance === '..' || distance.startsWith('..\\') || distance.startsWith('../')) return;
        if (message.commit && !/^[a-f0-9]{40,64}$/i.test(message.commit)) return;
        const document = message.commit
          ? await vscode.workspace.openTextDocument({ content: (await execFileAsync('git', ['show', `${message.commit}:${distance.replace(/\\/g, '/')}`], { cwd: root, maxBuffer: 2_000_000, windowsHide: true })).stdout, language: /\.tsx?$/.test(target) ? 'typescript' : 'javascript' })
          : await vscode.workspace.openTextDocument(vscode.Uri.file(target));
        const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        const line = Math.min(document.lineCount - 1, Math.max(0, (Number(message.location.startLine) || 1) - 1));
        editor.selection = new vscode.Selection(line, 0, line, 0);
        editor.revealRange(new vscode.Range(line, 0, line, 0));
      } catch { void vscode.window.showErrorMessage(vscode.l10n.t('Could not open the selected audit source file.')); }
    }
  }
}
