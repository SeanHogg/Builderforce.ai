import * as vscode from 'vscode';
import type { BrainRunHost } from './brainRunHost';
import { createBrainChat, startSystemAudit, getSystemAuditRun } from './systemAuditApi';
import { BuilderForcePanel } from './builderforcePanel';
import { getSelectedProject, onProjectChange } from './projectState';
import { appendBrainMessages, listSystemAudits } from './bfApi';
import { AuditResultsPanel } from './auditResultsPanel';

const CLOSE_KEY = 'builderforce.audits.pendingClose';
interface CloseIntent { projectId: number; auditId: string; requestId: string }

/** Close intent is durable before shutdown. Interrupted submissions retry at next activation. */
export class AuditExecution implements vscode.Disposable {
  private subscriptions: vscode.Disposable[] = [];
  private started = false;
  private disposed = false;
  private active = new Set<string>();

  constructor(private readonly ctx: vscode.ExtensionContext, private readonly host: BrainRunHost) {
    this.subscriptions.push(onProjectChange(() => void this.armClose().catch((e) => this.error(e))),
      vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('builderforce.audits')) void this.armClose().catch((error) => this.error(error)); }));
    void this.initialize().catch((e) => this.error(e));
  }

  private error(error: unknown): void {
    void vscode.window.showErrorMessage(vscode.l10n.t('Audit failed: {0}', String(error)));
  }

  private selected(): string[] {
    return vscode.workspace.getConfiguration('builderforce.audits').get<string[]>('selected', ['quality-audit']);
  }

  private async initialize(): Promise<void> {
    await this.flushClose();
    await this.armClose();
    if (this.started || this.disposed || !vscode.workspace.getConfiguration('builderforce.audits').get<boolean>('atStartup', false)) return;
    this.started = true;
    const projectId = getSelectedProject()?.id;
    if (projectId == null || !vscode.workspace.isTrusted) return;
    for (const auditId of this.selected()) void this.run(auditId, projectId, 'startup').catch((e) => this.error(e));
  }

  private async armClose(): Promise<void> {
    if (this.disposed) return;
    const projectId = getSelectedProject()?.id;
    const enabled = vscode.workspace.getConfiguration('builderforce.audits').get<boolean>('atClose', false);
    const old = this.ctx.workspaceState.get<CloseIntent[]>(CLOSE_KEY, []);
    const intents = enabled && vscode.workspace.isTrusted && projectId != null ? this.selected().map((auditId) =>
      old.find((r) => r.projectId === projectId && r.auditId === auditId) ?? { projectId, auditId, requestId: crypto.randomUUID() }) : [];
    await this.ctx.workspaceState.update(CLOSE_KEY, intents);
  }

  async flushClose(): Promise<void> {
    const pending = this.ctx.workspaceState.get<CloseIntent[]>(CLOSE_KEY, []);
    for (const intent of pending) {
      await startSystemAudit(this.ctx.secrets, intent.auditId, intent.projectId, 'cloud', 'close', intent.requestId);
      const remaining = this.ctx.workspaceState.get<CloseIntent[]>(CLOSE_KEY, []).filter((r) => r.requestId !== intent.requestId);
      await this.ctx.workspaceState.update(CLOSE_KEY, remaining);
    }
  }

  async run(auditId: string, projectId: number, trigger: 'manual' | 'startup' = 'manual'): Promise<void> {
    const key = `${projectId}:${auditId}`;
    if (this.active.has(key)) return;
    this.active.add(key);
    try { await this.runOnce(auditId, projectId, trigger); }
    finally { this.active.delete(key); }
  }

  private async runOnce(auditId: string, projectId: number, trigger: 'manual' | 'startup'): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error(vscode.l10n.t('Trust this workspace before running a local audit.'));
    if (!vscode.workspace.workspaceFolders?.length) throw new Error(vscode.l10n.t('Open a workspace folder before running a local audit.'));
    const chatId = await createBrainChat(this.ctx.secrets, { title: vscode.l10n.t('Audit: {0}', auditId), projectId });
    if (chatId == null) throw new Error(vscode.l10n.t('Sign in to save the audit conversation.'));
    const run = await startSystemAudit(this.ctx.secrets, auditId, projectId, 'local', trigger);
    await appendBrainMessages(this.ctx.secrets, chatId, [{ role: 'user', content: run.briefing }]);
    const detach = this.host.attach({ post: (message) => {
      if (message.chatId === chatId && message.type === 'run.sync' && message.snapshot.pendingConfirm) {
        void BuilderForcePanel.open(this.ctx, { kind: 'focus', chatId });
      }
    } });
    void vscode.commands.executeCommand('builderforce.refreshSessions');
    try {
      await this.host.start({ chatId, projectId, systemPrompt: run.briefing + "\nFor this local run, use save_audit_findings to submit the report; its run and project are already bound by the host.",
        userTurn: run.briefing, autoApprove: false, evermind: true, chatMode: 'work',
        audit: { runId: run.runId, auditId },
      });
      const saved = await getSystemAuditRun(this.ctx.secrets, auditId, projectId, run.runId);
      if (saved.status !== 'completed') {
        await BuilderForcePanel.open(this.ctx, { kind: 'focus', chatId });
        throw new Error(saved.error ?? vscode.l10n.t('The audit has not saved its findings. Open its conversation to continue.'));
      }
      await vscode.commands.executeCommand('builderforce.refreshDiagnostics');
      const catalog = await listSystemAudits(this.ctx.secrets);
      const definition = catalog.find((d) => d.id === auditId);
      if (saved.result?.codeAnalysis) AuditResultsPanel.open(this.ctx, saved.result);
      else if (saved.result) await vscode.commands.executeCommand('builderforce.openDiagnosticReport', {
        auditId, name: definition?.name ?? auditId, emoji: definition?.icon ?? '',
        result: saved.result, ticketIds: saved.ticketIds, projectId,
      });
      const action = await vscode.window.showInformationMessage(vscode.l10n.t('Audit complete. Findings and remediation tickets are saved.'), vscode.l10n.t('Open audit conversation'));
      if (action) await BuilderForcePanel.open(this.ctx, { kind: 'focus', chatId });
    } finally { detach(); }
  }

  dispose(): void { this.disposed = true; for (const s of this.subscriptions) s.dispose(); }
}
