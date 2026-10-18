import { describe, expect, it, vi } from 'vitest';
vi.mock('./bfApi', () => ({ authed: vi.fn(async () => ({ completed: true })) }));
import { authed } from './bfApi';
import { auditToolCatalog } from './auditToolCatalog';
import type { ToolDef } from './fileTools';

const tool = (name: string, mutating: boolean, remote = false): ToolDef => ({ name, mutating, remote, description: '', parameters: {}, execute: vi.fn() });

describe('audit tool boundary', () => {
  it('allows source reads and approved commands but excludes edits, dispatch and delegation', () => {
    const defs = auditToolCatalog({} as never, [tool('read_file', false), tool('write_file', true),
      tool('run_command', true), tool('builtin_tasks_create', true, true), tool('spawn_agent', false)], 7, { auditId: 'quality-audit', runId: 'run' });
    expect(defs.map((d) => d.name)).toEqual(['read_file', 'run_command', 'save_audit_findings']);
    expect(defs.find((d) => d.name === 'run_command')?.mutating).toBe(true);
  });
  it('binds saved findings to the host project and run rather than agent-supplied identifiers', async () => {
    const defs = auditToolCatalog({} as never, [], 7, { auditId: 'quality-audit', runId: 'run' });
    await defs[0]!.execute({ projectId: 99, runId: 'other', findings: [] }, '');
    expect(authed).toHaveBeenCalledWith(expect.anything(), '/api/tools/audits/quality-audit/findings', {
      method: 'POST', body: JSON.stringify({ projectId: 7, runId: 'run', findings: [] }),
    });
  });
});
