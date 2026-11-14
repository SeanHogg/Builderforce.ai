import * as vscode from 'vscode';
import { authed } from './bfApi';
import { getGitApi, findRepository } from './gitApi';
export async function startSystemAudit(secrets, auditId, projectId, executor, trigger, requestId) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const git = await getGitApi();
    const state = git && root ? findRepository(git, root)?.state : undefined;
    const result = await authed(secrets, `/api/tools/audits/${encodeURIComponent(auditId)}/run`, {
        method: 'POST', body: JSON.stringify({ projectId, executor, requestId, source: {
                surface: 'vsix', trigger, branch: state?.HEAD?.name, commit: state?.HEAD?.commit,
                dirty: state ? !!(state.workingTreeChanges.length + state.indexChanges.length + (state.untrackedChanges?.length ?? 0)) : undefined,
            } }),
    });
    if (!result)
        throw new Error(vscode.l10n.t('Sign in to run audits.'));
    if (result.dispatch?.refusal)
        throw new Error(result.dispatch.refusal.message);
    return result;
}
export async function getSystemAuditRun(secrets, auditId, projectId, runId) {
    const result = await authed(secrets, `/api/tools/audits/${encodeURIComponent(auditId)}/runs/${encodeURIComponent(runId)}?projectId=${projectId}`);
    if (!result)
        throw new Error(vscode.l10n.t('Could not load the saved audit.'));
    return result.run;
}
//# sourceMappingURL=systemAuditApi.js.map