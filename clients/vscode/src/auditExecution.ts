import * as vscode from 'vscode';
import type { BrainRunHost } from './brainRunHost';
import { createBrainChat, startSystemAudit, getSystemAuditRun } from './systemAuditApi';
import { BuilderForcePanel } from './builderforcePanel';
import { getSelectedProject, onProjectChange } from './projectState';
import { appendBrainMessages, listSystemAudits } from './bfApi';
import { AuditResultsPanel } from './auditResultsPanel';
import { registerAuditFindingsSink } from './auditToolCatalog';
import { findRepository, getGitApi } from './gitApi';
import { localBrainApplication } from './localFirstStore';
import { platformPolicy } from './platformPolicy';
import { closeAuditLocally, readClosedAudit, refuseCloudLaunch, type DurableAuditClose } from './auditCloseCheckpoint';
import {
  ensureLocalAuditDefinitions,
  ensureLocalAuditDeviceId,
  getLocalAuditRun,
  listLocalAuditFindings,
  loadLocalAuditDefinition,
  markLocalAuditRun,
  recoverInterruptedAuditRuns,
  startLocalAuditRun,
} from './localAuditStore';

const CLOSE_KEY = 'builderforce.audits.pendingClose';
const LOCAL_RUN_SUFFIX = '\nFor this local run, use save_audit_findings to submit the report; its run and project are already bound by the host.';
interface CloseIntent { projectId: number; auditId: string; requestId: string }

/** A cloud audit session needs a synchronize write and a connected-feature read. */
function cloudAuditDenied(): boolean {
  const policy = platformPolicy();
  return !policy.allows('synchronize') || !policy.allows('connected-feature');
}

function evidenceDetail(evidence: unknown): string {
  if (!evidence || typeof evidence !== 'object') return '';
  const detail = (evidence as { detail?: unknown }).detail;
  return typeof detail === 'string' ? detail : '';
}

/** Close intent is durable before shutdown. Closing marks the audit closed locally and never launches a cloud audit. */
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
    try { await this.recoverLocalAudits(); } catch (error) { this.error(error); }
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
      await this.closeLocally(intent);
      const remaining = this.ctx.workspaceState.get<CloseIntent[]>(CLOSE_KEY, []).filter((r) => r.requestId !== intent.requestId);
      await this.ctx.workspaceState.update(CLOSE_KEY, remaining);
    }
  }

  async run(auditId: string, projectId: number, trigger: 'manual' | 'startup' = 'manual', runId?: string): Promise<void> {
    const key = `${projectId}:${auditId}`;
    if (this.active.has(key)) return;
    this.active.add(key);
    try { await this.runOnce(auditId, projectId, trigger, runId); }
    finally { this.active.delete(key); }
  }

  private async runOnce(auditId: string, projectId: number, trigger: 'manual' | 'startup', runId?: string): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error(vscode.l10n.t('Trust this workspace before running a local audit.'));
    if (!vscode.workspace.workspaceFolders?.length) throw new Error(vscode.l10n.t('Open a workspace folder before running a local audit.'));
    // Supported audits execute from the local definition store. Close stays in flushClose (G08).
    const localAudit = await this.localAuditContext();
    await ensureLocalAuditDefinitions(localAudit.store, { deviceId: localAudit.deviceId });
    const definition = await loadLocalAuditDefinition(localAudit.store, auditId);
    if (definition || cloudAuditDenied()) {
      await this.runLocal(auditId, projectId, trigger, runId);
      return;
    }
    // G08: a run that already closed locally is complete. It must not be relaunched as
    // cloud work just because a definition and network are both available — that is the
    // one case where "can we run it?" and "should we run it?" disagree. The refusal is
    // read from the durable close record, not from an in-memory flag, so it survives a
    // restart exactly as the close itself does.
    if (runId && !refuseCloudLaunch(await readClosedAudit((await this.localAuditContext()).store, runId)).launch) {
      await vscode.window.showInformationMessage(vscode.l10n.t('This audit was closed locally and will not be relaunched.'));
      return;
    }
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
      await this.host.start({ chatId, projectId, systemPrompt: run.briefing + LOCAL_RUN_SUFFIX,
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

  /** Crash recovery never resumes a source review. Import of a finished run must not replay it. */
  private async recoverLocalAudits(): Promise<void> {
    const { store, deviceId } = await this.localAuditContext();
    await recoverInterruptedAuditRuns(store, { deviceId });
  }

  /** Closing an audit is a local completion. It never calls startSystemAudit or starts a host run. */
  private async closeLocally(intent: CloseIntent): Promise<void> {
    const { store, deviceId } = await this.localAuditContext();
    // G08: go through the checkpoint's close, not `closeLocalAuditRun` directly. That
    // wrapper is what makes the completion DURABLE and self-refusing: it first recovers
    // interrupted runs (so a close cannot strand one in `running`), then writes the
    // local-complete record, then re-reads it and refuses the cloud launch. Calling the
    // store helper directly skipped both, so a closed audit was not actually closed in
    // the sense the launcher checks. `closeAuditLocally` throws if the record it cannot
    // verify; that throw is the point — a close that did not stick must not read as one.
    await closeAuditLocally({
      store,
      deviceId,
      auditId: intent.auditId,
      projectId: intent.projectId,
      runId: intent.requestId,
      source: await this.closeSource(),
    });
  }

  /**
   * Offline audit: packaged definition, local session, local chat, and a findings sink.
   * An id that already exists (imported, recovered, or retried) is not executed again.
   */
  private async runLocal(auditId: string, projectId: number, trigger: 'manual' | 'startup', runId?: string): Promise<void> {
    const { store, deviceId, persistence } = await this.localAuditContext();
    if (runId && await getLocalAuditRun(store, runId)) return;
    const started = await startLocalAuditRun(store, { deviceId }, {
      auditId, projectId, trigger, ...(runId ? { runId } : {}), source: await this.auditSource(trigger),
    });
    const stored = await getLocalAuditRun(store, started.runId);
    if (!stored || stored.record.payload.status !== 'running') return;

    const chat = await persistence.createChat({ title: vscode.l10n.t('Audit: {0}', auditId), projectId });
    await persistence.sendMessages(chat.id, [{ role: 'user', content: started.briefing }]);
    const unregister = registerAuditFindingsSink(started.runId, { store, deviceId });
    const detach = this.host.attach({ post: (message) => {
      if (message.chatId === chat.id && message.type === 'run.sync' && message.snapshot.pendingConfirm) {
        void BuilderForcePanel.open(this.ctx, { kind: 'focus', chatId: chat.id });
      }
    } });
    void vscode.commands.executeCommand('builderforce.refreshSessions');
    try {
      await this.host.start({
        chatId: chat.id, projectId, systemPrompt: started.briefing + LOCAL_RUN_SUFFIX,
        userTurn: started.briefing, autoApprove: false, evermind: true, chatMode: 'work',
        audit: { runId: started.runId, auditId },
      });
      const saved = await getLocalAuditRun(store, started.runId);
      if (saved?.record.payload.status !== 'completed') {
        await BuilderForcePanel.open(this.ctx, { kind: 'focus', chatId: chat.id });
        throw new Error(saved?.record.payload.error ?? vscode.l10n.t('The audit has not saved its findings. Open its conversation to continue.'));
      }
      await vscode.commands.executeCommand('builderforce.refreshDiagnostics');
      const findings = await listLocalAuditFindings(store, started.runId);
      await vscode.commands.executeCommand('builderforce.openDiagnosticReport', {
        auditId, name: started.definition.name, emoji: started.definition.icon, projectId, ticketIds: [],
        result: {
          headline: vscode.l10n.t('Audit complete. Findings and remediation tickets are saved.'),
          summary: started.definition.blurb,
          audit: { runId: started.runId, projectId, status: 'completed', ticketIds: [] },
          recommendations: findings.map((finding) => ({ title: finding.summary, detail: evidenceDetail(finding.evidence) })),
        },
      });
      const action = await vscode.window.showInformationMessage(vscode.l10n.t('Audit complete. Findings and remediation tickets are saved.'), vscode.l10n.t('Open audit conversation'));
      if (action) await BuilderForcePanel.open(this.ctx, { kind: 'focus', chatId: chat.id });
    } catch (error) {
      const current = await getLocalAuditRun(store, started.runId);
      if (current?.record.payload.status === 'running') {
        await markLocalAuditRun(store, { deviceId }, { runId: started.runId, status: 'failed', error: String(error), safeToResume: false });
      }
      throw error;
    } finally {
      unregister();
      detach();
    }
  }

  private async localAuditContext() {
    const deviceId = await ensureLocalAuditDeviceId(this.ctx.globalState);
    const local = localBrainApplication(this.ctx);
    return { store: local.store, deviceId, persistence: local.persistence };
  }

  /**
   * The close path's provenance, narrowed to the shape `closeAuditLocally` stores.
   * `auditSource` returns `Record<string, unknown>` because the start path accepts
   * any trigger; passing that here would let a widened `surface` or `trigger` reach
   * the durable record. This builds the literal `{ surface: 'vsix', trigger: 'close' }`
   * and copies only the optional git fields, so the stored source cannot drift.
   */
  private async closeSource(): Promise<DurableAuditClose['source']> {
    const gathered = await this.auditSource('close');
    return {
      surface: 'vsix',
      trigger: 'close',
      ...(typeof gathered.branch === 'string' ? { branch: gathered.branch } : {}),
      ...(typeof gathered.commit === 'string' ? { commit: gathered.commit } : {}),
      ...(typeof gathered.dirty === 'boolean' ? { dirty: gathered.dirty } : {}),
    };
  }

  private async auditSource(trigger: 'manual' | 'startup' | 'close'): Promise<Record<string, unknown>> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const source: Record<string, unknown> = { surface: 'vsix', trigger };
    try {
      const git = await getGitApi();
      const repo = git && root ? findRepository(git, root) : undefined;
      const head = repo?.state.HEAD;
      if (head?.name) source.branch = head.name;
      if (head?.commit) source.commit = head.commit;
      if (repo) {
        const dirty = repo.state.workingTreeChanges.length + repo.state.indexChanges.length + (repo.state.untrackedChanges?.length ?? 0);
        source.dirty = dirty > 0;
      }
    } catch { /* provenance is best-effort */ }
    return source;
  }

  dispose(): void { this.disposed = true; for (const s of this.subscriptions) s.dispose(); }
}
