/**
 * Proves the per-gap dedup in AuditRunner.runAudit: re-running a ticketPerFinding
 * audit (Privacy) before the gaps are fixed does NOT re-file duplicate tickets for
 * gaps that already have an OPEN remediation ticket. The first run files one ticket
 * per gap; the second run — with those titles reported as open — files none.
 */
import { describe, it, expect, vi } from 'vitest';
import { AuditRunner } from './AuditRunner';
import { PRIVACY_AUDIT_ID } from './auditIds';
import type { AuditScanContext, ScannedRepo } from './auditScanners';

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

function fakeBoard() {
  const tasks: Array<{ id: number; title: string; status: string }> = [];
  let nextId = 1000;
  const taskService = {
    createTask: vi.fn(async (input: { title: string }) => {
      const t = { id: nextId++, title: input.title, status: 'todo' };
      tasks.push(t);
      return { id: t.id, status: t.status };
    }),
  };
  return { tasks, taskService };
}

describe('Privacy diagnostic — per-gap dedup on re-run', () => {
  it('skips gaps that already have an open remediation ticket', async () => {
    const board = fakeBoard();
    const toolService = {
      recordExternalRun: vi.fn(async (_env: unknown, args: { toolId: string; result: unknown }) => ({
        id: 'run', toolId: args.toolId, kind: 'data', projectId: 42, input: {}, result: args.result, createdBy: 'u1', createdAt: '2026-07-11T00:00:00Z',
      })),
    };

    const runner = new AuditRunner({} as never, toolService as never, board.taskService as never);
    vi.spyOn(runner, 'buildContext').mockResolvedValue({
      projectId: 42, projectName: 'Builderforce.ai', reposConfigured: 1, repos: [bareRepo()],
    } satisfies AuditScanContext);
    const sql = (() => Promise.resolve([])) as never;

    // Run 1 — no open tickets yet → one per gap filed.
    const first = await runner.runAudit({} as never, sql, {
      tenantId: 7, projectId: 42, auditId: PRIVACY_AUDIT_ID, userId: 'u1', secret: 's',
    });
    const filed = first!.agentTasks!.length;
    expect(filed).toBeGreaterThanOrEqual(5);
    expect(board.tasks).toHaveLength(filed);

    // Run 2 — every filed title is now reported OPEN → dedup skips all of them.
    const openTitles = new Set(board.tasks.map((t) => t.title.trim().toLowerCase()));
    vi.spyOn(runner as unknown as { openTaskTitles: (p: number) => Promise<Set<string>> }, 'openTaskTitles')
      .mockResolvedValue(openTitles);

    const second = await runner.runAudit({} as never, sql, {
      tenantId: 7, projectId: 42, auditId: PRIVACY_AUDIT_ID, userId: 'u1', secret: 's',
    });
    expect(second!.agentTasks).toHaveLength(0);           // nothing re-filed
    expect(second!.mode).toBe('deterministic');            // no tickets → deterministic
    expect(board.tasks).toHaveLength(filed);               // board unchanged (no duplicates)
  });
});
