/**
 * Proves the privacy diagnostic's create→resolve ticket lifecycle end-to-end
 * through the REAL AuditRunner.runAudit: with the scan context spied (so no DB /
 * git), a bare repo → privacyScan flags every gap → runAudit files ONE ticket per
 * gap (ticketPerFinding) and records the diagnostic. We then simulate the agent
 * closing each ticket to show the lifecycle. This is the mechanism the live board
 * exercises: file per-gap tickets, lane-autorun dispatches the agent, agent
 * resolves each via a remediation PR.
 */
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

describe('Privacy diagnostic — per-gap ticket create→resolve', () => {
  it('files one remediation ticket per gap and each can be resolved', async () => {
    const board = fakeBoard();
    const recorded: Array<{ toolId: string; result: { headline: string } }> = [];
    const toolService = {
      recordExternalRun: vi.fn(async (_env: unknown, args: { toolId: string; result: { headline: string } }) => {
        recorded.push({ toolId: args.toolId, result: args.result });
        return { id: 'run-1', toolId: args.toolId, kind: 'data', projectId: 42, input: {}, result: args.result, createdBy: 'u1', createdAt: '2026-07-05T00:00:00Z' };
      }),
    };

    const runner = new AuditRunner({} as never, toolService as never, board.taskService as never);
    // Spy the DB/git-backed context builder so the test is pure.
    vi.spyOn(runner, 'buildContext').mockResolvedValue({
      projectId: 42, projectName: 'Builderforce.ai', reposConfigured: 1, repos: [bareRepo()],
    } satisfies AuditScanContext);

    const sql = (() => Promise.resolve([])) as never; // notify() no-op
    const outcome = await runner.runAudit({} as never, sql, {
      tenantId: 7, projectId: 42, auditId: PRIVACY_AUDIT_ID, userId: 'u1', secret: 's',
    });

    expect(outcome).not.toBeNull();
    // The diagnostic was recorded under the privacy id (feeds the project rating).
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.toolId).toBe(PRIVACY_AUDIT_ID);

    // One ticket per gap — privacyScan flags all six data-subject obligations here.
    expect(board.tasks.length).toBeGreaterThanOrEqual(5);
    expect(outcome!.agentTasks).toHaveLength(board.tasks.length);
    // Every ticket carries the privacy_audit workflow hint + a legal-obligation title.
    for (const t of board.tasks) {
      expect(t.persona).toBe('privacy_audit');
      expect(t.title.startsWith('Privacy & Data-Law Compliance:')).toBe(true);
      expect(t.status).toBe('todo');
    }
    // At least one names an unmistakable data-law obligation.
    expect(board.tasks.some((t) => /unsubscribe/i.test(t.title))).toBe(true);
    expect(board.tasks.some((t) => /erasure/i.test(t.title))).toBe(true);

    // Resolve loop — the agent closes each remediation ticket via its PR.
    for (const t of outcome!.agentTasks!) board.resolve(t.taskId);
    expect(board.tasks.every((t) => t.status === 'done')).toBe(true);
  });
});
