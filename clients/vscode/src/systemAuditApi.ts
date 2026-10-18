import * as vscode from 'vscode';
import { authed, type BfProjectDiagnostic } from './bfApi';
import { getGitApi, findRepository } from './gitApi';
export { createBrainChat } from './bfApi';

export interface SystemAuditStart { runId: string; briefing: string; dispatch?: { executionId: number | null; refusal?: { message: string } } }

export async function startSystemAudit(secrets: vscode.SecretStorage, auditId: string, projectId: number,
  executor: 'local' | 'cloud', trigger: 'manual' | 'startup' | 'close', requestId?: string): Promise<SystemAuditStart> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const git = await getGitApi();
  const state = git && root ? findRepository(git, root)?.state : undefined;
  const result = await authed<SystemAuditStart>(secrets, `/api/tools/audits/${encodeURIComponent(auditId)}/run`, {
    method: 'POST', body: JSON.stringify({ projectId, executor, requestId, source: {
      surface: 'vsix', trigger, branch: state?.HEAD?.name, commit: state?.HEAD?.commit,
      dirty: state ? !!(state.workingTreeChanges.length + state.indexChanges.length + (state.untrackedChanges?.length ?? 0)) : undefined,
    } }),
  });
  if (!result) throw new Error(vscode.l10n.t('Sign in to run audits.'));
  if (result.dispatch?.refusal) throw new Error(result.dispatch.refusal.message);
  return result;
}

interface SavedAudit { status: string; result?: BfProjectDiagnostic['result']; ticketIds?: number[]; error?: string | null }
export async function getSystemAuditRun(secrets: vscode.SecretStorage, auditId: string, projectId: number, runId: string): Promise<SavedAudit> {
  const result = await authed<{ run: SavedAudit }>(secrets,
    `/api/tools/audits/${encodeURIComponent(auditId)}/runs/${encodeURIComponent(runId)}?projectId=${projectId}`);
  if (!result) throw new Error(vscode.l10n.t('Could not load the saved audit.'));
  return result.run;
}
