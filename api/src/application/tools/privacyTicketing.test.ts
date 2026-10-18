import { describe, it, expect, vi } from 'vitest';
import { AuditRunner } from './AuditRunner';
import { PRIVACY_AUDIT_ID } from './auditIds';
import type { AuditScanContext, ScannedRepo } from './auditScanners';

/** A repo with none of the privacy affordances — every pillar is a gap. */
function bareRepo(): ScannedRepo {
  return {
    provider: 'github', owner: 'SeanHogg', repo: 'Builderforce.ai', defaultBranch: 'main', read: true,
    hasCi: true, hasTests: true, hasReadme: true, hasLicense: true, hasSecurityPolicy: false,
    hasDependencyManifest: true, hasLockfile: true, hasCodeowners: false, hasContributing: false,
    suspectedSecrets: 0, fileCount: 8339,
    hasPrivacyPolicy: false, hasTermsOfService: false, hasCookiePolicy: false, hasCookieConsent: false,
    hasUnsubscribe: false, hasDataExport: false, hasDataDeletion: false, hasRetentionPolicy: false,
    hasRightsRequestWorkflow: false, hasUniversalOptOut: false, hasDpa: false,
    hasSubprocessorRegister: false, hasDataInventory: false, hasImpactAssessment: false,
    hasPrivacyIncidentResponse: false, hasAiTransparency: false,
    hasAutomatedDecisionSafeguards: false, hasMinorSafety: false,
    hasTransferSafeguards: false, hasAccessibilityEvidence: false,
  };
}

/** A tiny in-memory board standing in for TaskService — records created tasks and
 *  lets us resolve them, so we can assert the create→resolve lifecycle. */
function fakeBoard() {
  const tasks: Array<{ id: number; title: string; description: string; persona?: string; status: string }> = [];
  let nextId = 1000;
  const taskService = {
    createTask: vi.fn(async (input: { title: string; description: string; persona?: string }) => {
      const t = { id: nextId++, title: input.title, description: input.description, persona: input.persona, status: 'todo' };
      tasks.push(t);
      return { id: t.id, status: t.status };
    }),
  };
  const resolve = (id: number) => { const t = tasks.find((x) => x.id === id); if (t) t.status = 'done'; };
  return { tasks, taskService, resolve };
}

describe('Privacy audit execution', () => {
  it('creates one source-review task, with remediation deferred until verified findings arrive', async () => {
    const board = fakeBoard();
    const db = {
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'audit-run' }] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    const toolService = { recordExternalRun: vi.fn(async (_env: unknown, args: { result: unknown }) => ({ id: 'report', result: args.result })) };
    const runner = new AuditRunner(db as never, toolService as never, board.taskService as never);
    vi.spyOn(runner, 'buildContext').mockResolvedValue({
      projectId: 42, projectName: 'Builderforce.ai', reposConfigured: 1, repos: [bareRepo()],
    } satisfies AuditScanContext);
    const result = await runner.runAudit({} as never, {
      tenantId: 7, projectId: 42, auditId: PRIVACY_AUDIT_ID, userId: 'u1', secret: 's',
    });
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]?.persona).toBe('privacy_audit');
    expect(result?.briefing).toContain('audit-run');
    expect(result?.briefing).toContain('Do not create duplicate tickets');
    expect(result?.briefing).toContain('do not modify source');
    expect(toolService.recordExternalRun).toHaveBeenCalledOnce();
  });
  it('starts a local run without a cloud task', async () => {
    const board = fakeBoard();
    const db = { insert: () => ({ values: () => ({ returning: async () => [{ id: 'local-run' }] }) }) };
    const runner = new AuditRunner(db as never, { recordExternalRun: async () => ({ id: 'report' }) } as never, board.taskService as never);
    vi.spyOn(runner, 'buildContext').mockResolvedValue({ projectId: 42, projectName: 'Workspace', reposConfigured: 0, repos: [] });
    const result = await runner.runAudit({} as never, { tenantId: 7, projectId: 42, auditId: PRIVACY_AUDIT_ID, userId: 'u1', secret: 's', executor: 'local' });
    expect(result?.executor).toBe('local');
    expect(result?.agentTasks).toEqual([]);
    expect(board.tasks).toEqual([]);
  });
});
