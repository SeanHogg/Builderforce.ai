/**
 * containProvider / platformTools — the host's containment and the cloud's own tools (PRD 35 WS3). Fakes only at the
 * DB / trust / platform-catalog edge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityProvider } from '@builderforce/agent-tools';

const h = vi.hoisted(() => ({
  inspect: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean; reasons?: string[] }),
  record: vi.fn(async (..._a: unknown[]) => undefined),
  call: vi.fn(async (..._a: unknown[]) => ({ created: true })),
  saved: vi.fn(async (..._a: unknown[]) => ({ summary: true })),
}));
vi.mock('../trust/trustService', () => ({ inspectOutboundContent: h.inspect }));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));
vi.mock('../llm/builtinMcpService', () => ({
  callBuiltinTool: h.call,
  cloudAgentPlatformToolSchemas: () => [{ type: 'function', function: { name: 'builtin_tasks_create', description: '', parameters: { type: 'object', properties: {} } } }],
  resolveCloudAgentPlatformTool: (name: string) => (name === 'builtin_tasks_create' || name === 'builtin_chats_send_message' ? name.replace('builtin_', '').replace(/_/g, '.') : null),
}));
vi.mock('./cloudAgent/auditAnalysis', () => ({ ANALYZE_CODEBASE_TOOL: 'analyze_codebase', withSavedAnalysis: h.saved }));

import { containProvider, platformTools } from './cloudAdapterTools';

beforeEach(() => vi.clearAllMocks());

function provider(): CapabilityProvider & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    capabilities: new Set(),
    repoWrite: {
      writeFile: async (path: string) => { writes.push(path); return { ok: true }; },
      editFile: async (path: string) => { writes.push(path); return { ok: true }; },
      deleteFile: async (path: string) => { writes.push(path); return { ok: true }; },
    },
    human: { ask: async () => ({ paused: true, approvalId: 'a1' }) },
  } as never;
}
const contain = (p: CapabilityProvider, written: string[], maxFiles: number | null) => containProvider(p, {
  db: {} as never, tenantId: 1, executionId: 2, declared: { maxFiles, maxRepositories: null, maxSpendMillicents: null },
  writtenPaths: new Set(written), repositories: 1,
});

describe('containProvider', () => {
  it('lets a write inside the declared footprint through, and a re-write of a known path never counts twice', async () => {
    const p = provider();
    const guarded = contain(p, ['a.ts'], 2);
    expect(await guarded.repoWrite!.writeFile('b.ts', 'x')).toMatchObject({ ok: true });
    expect(await guarded.repoWrite!.editFile('a.ts', 'o', 'n')).toMatchObject({ ok: true });
    expect(p.writes).toEqual(['b.ts', 'a.ts']);
  });

  it('refuses a write that would exceed max_files with the named reason, and records it on the timeline', async () => {
    const p = provider();
    const refused = await contain(p, ['a.ts', 'b.ts'], 2).repoWrite!.writeFile('c.ts', 'x');
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('file limit exceeded (3/2)') });
    expect(p.writes).toEqual([]);
    expect(h.record.mock.calls[0]?.[1]).toMatchObject({ toolName: 'containment.blocked', detail: { tool: 'write_file', path: 'c.ts' } });
  });

  it('never lets credential material leave in a question to a person', async () => {
    h.inspect.mockResolvedValueOnce({ ok: false, reasons: ['credential_token'] });
    const asked = await contain(provider(), [], null).human!.ask('use sk-abcdefghijkl', undefined);
    expect(asked).toMatchObject({ paused: false, error: expect.stringContaining('credential_token') });
  });
});

describe('platformTools', () => {
  const tools = platformTools({ env: {} as never, db: {} as never, tenantId: 1, projectId: 9, meterExecutionId: 5, executionId: 5, cloudAgentRef: 'ref', originatingChatId: 77 });

  it('advertises the curated tools and handles only those', () => {
    expect(tools.schemas().map((s) => s.function.name)).toEqual(['builtin_tasks_create']);
    expect(tools.handles('builtin_tasks_create')).toBe(true);
    expect(tools.handles('write_file')).toBe(false);
  });

  it('runs a platform tool in-process, defaulting the project and the originating chat, billed to the metered execution', async () => {
    expect(await tools.dispatch('builtin_tasks_create', { title: 'T' })).toEqual({ data: { created: true } });
    expect(h.call.mock.calls[0]?.[1]).toMatchObject({ tenantId: 1, tool: 'tasks.create', arguments: { projectId: 9, title: 'T', chatId: 77 }, executionId: 5 });
  });

  it('blocks an outbound message carrying credential material, and reports a tool failure as the tool\'s own', async () => {
    h.inspect.mockResolvedValueOnce({ ok: false, reasons: ['private_key'] });
    expect(await tools.dispatch('builtin_chats_send_message', { text: 'key' })).toMatchObject({ isError: true });
    h.call.mockRejectedValueOnce(new Error('boom'));
    expect(await tools.dispatch('builtin_tasks_create', {})).toEqual({ data: { ok: false, error: 'boom' }, isError: true });
  });

  it('shapes an analyze_codebase result through the saved-analysis path and leaves every other result alone', async () => {
    await tools.shape!('analyze_codebase', { snapshot: {} });
    expect(h.saved).toHaveBeenCalledTimes(1);
    expect(await tools.shape!('read_file', { ok: true })).toEqual({ ok: true });
  });
});
