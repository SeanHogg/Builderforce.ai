import { describe, expect, it, vi } from 'vitest';
import { type ManifestFileStore } from './appManifestToolCatalog';
import { type BuiltinCtx } from './builtinToolContext';
import {
  createRuntimeAgentsTools,
  RUNTIME_AGENT_TASK_MAX_LENGTH,
  type RuntimeAgentsPort,
} from './runtimeAgentsToolCatalog';

const PROJECT_ID = 7;
const CATALOG_KEYS: ReadonlySet<string> = new Set(['tasks.list', 'runtime.agents.list']);
const VALID = { version: 1, services: { web: { runtime: 'node', command: 'node server.js', port: 3000 } } };

/** A manifest declaring `triage` with the given declaration, `capabilities.agents` enabled. */
const withAgent = (agent: Record<string, unknown>) => ({ ...VALID, capabilities: { agents: {} }, agents: { triage: agent } });

function memoryFiles(manifest: unknown | null): ManifestFileStore {
  return {
    read: async () => (manifest === null ? null : { path: '.builderforce/builderforce.json', text: JSON.stringify(manifest) }),
    write: async () => { throw new Error('runtime.agents tools never write the manifest'); },
  };
}

/** The caller owns PROJECT_ID only; the tenant comes from ctx. */
const ctx = {
  tenantId: 1,
  projects: {
    getProject: vi.fn(async (id: number, tenantId: number) => {
      if (id !== PROJECT_ID || tenantId !== 1) throw new Error('not found');
      return { id };
    }),
  },
} as unknown as BuiltinCtx;

function stubPort(): RuntimeAgentsPort {
  return {
    start: vi.fn(async () => ({ runId: 'run-1' })),
    steer: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ state: 'thinking' })),
  };
}

function setup(manifest: unknown | null, port?: RuntimeAgentsPort) {
  const files = memoryFiles(manifest);
  const tools = createRuntimeAgentsTools({ catalogKeys: () => CATALOG_KEYS, port, files });
  const tool = (name: string) => tools.find((t) => t.tool === name)!;
  return { files, tool };
}

type Result = { ok: boolean; code?: string; [key: string]: unknown };
const START_ARGS = { projectId: PROJECT_ID, agentId: 'triage', task: 'triage the backlog' };

describe('runtime.agents tools', () => {
  it('declares the five tools with the right mutates flags', () => {
    const { tool } = setup(null);
    const flags = ['list', 'status', 'start', 'steer', 'cancel'].map((n) => [n, tool(`runtime.agents.${n}`).mutates]);
    expect(flags).toEqual([['list', false], ['status', false], ['start', true], ['steer', true], ['cancel', true]]);
  });

  it('refuses a project the caller does not own, on every tool, without touching the manifest or the port', async () => {
    const port = stubPort();
    const { tool, files } = setup(withAgent({ role: 'developer' }), port);
    const read = vi.spyOn(files, 'read');
    const calls: Array<[string, Record<string, unknown>]> = [
      ['list', {}],
      ['status', { runId: 'run-1' }],
      ['start', { agentId: 'triage', task: 'x' }],
      ['steer', { runId: 'run-1', message: 'hi' }],
      ['cancel', { runId: 'run-1' }],
    ];
    for (const [name, args] of calls) {
      const r = (await tool(`runtime.agents.${name}`).run(ctx, { projectId: 99, ...args })) as Result;
      expect(r.ok).toBe(false);
    }
    expect(read).not.toHaveBeenCalled();
    for (const fn of Object.values(port)) expect(fn).not.toHaveBeenCalled();
  });

  it('resolves the project through the ctx tenant, not an argument user id', async () => {
    const { tool } = setup(withAgent({ role: 'developer' }), stubPort());
    await tool('runtime.agents.list').run(ctx, { projectId: PROJECT_ID, userId: 'someone-else', tenantId: 2 });
    expect(ctx.projects.getProject).toHaveBeenLastCalledWith(PROJECT_ID, 1);
  });

  it('lists the declared agents with ids, roles and tools', async () => {
    const { tool } = setup(withAgent({ role: 'developer', tools: ['env.fs.read', 'tasks.list'] }));
    const r = (await tool('runtime.agents.list').run(ctx, { projectId: PROJECT_ID })) as Result;
    expect(r).toMatchObject({ ok: true, agents: [{ id: 'triage', role: 'developer', tools: ['env.fs.read', 'tasks.list'] }] });
  });

  it('start refuses a tool that is not a catalog key with tool-not-in-catalog, listing it', async () => {
    const port = stubPort();
    const { tool } = setup(withAgent({ role: 'developer', tools: ['env.fs.read', 'tasks.list', 'made.up_tool'] }), port);
    const r = (await tool('runtime.agents.start').run(ctx, START_ARGS)) as Result;
    expect(r).toMatchObject({ ok: false, code: 'tool-not-in-catalog', tools: ['made.up_tool'] });
    expect(port.start).not.toHaveBeenCalled();
  });

  it('start refuses a declaration that names a model with model-id-refused', async () => {
    const port = stubPort();
    for (const agent of [{ role: 'developer', model: 'gpt-4o' }, { role: 'anthropic/claude-sonnet' }, { role: 'gpt-4o' }]) {
      const { tool } = setup(withAgent(agent), port);
      const r = (await tool('runtime.agents.start').run(ctx, START_ARGS)) as Result;
      expect(r).toMatchObject({ ok: false, code: 'model-id-refused' });
    }
    expect(port.start).not.toHaveBeenCalled();
  });

  it('start refuses a model passed as an argument, or as the agent id, with model-id-refused', async () => {
    const port = stubPort();
    const { tool } = setup(withAgent({ role: 'developer' }), port);
    for (const args of [{ ...START_ARGS, model: 'gpt-4o' }, { ...START_ARGS, agentId: 'claude-sonnet' }, { ...START_ARGS, agentId: 'gpt-4o:latest' }]) {
      const r = (await tool('runtime.agents.start').run(ctx, args)) as Result;
      expect(r).toMatchObject({ ok: false, code: 'model-id-refused' });
    }
    expect(port.start).not.toHaveBeenCalled();
  });

  it('start refuses an agent id off the role pattern, and a missing or oversized task', async () => {
    const port = stubPort();
    const { tool } = setup(withAgent({ role: 'developer' }), port);
    const start = (args: Record<string, unknown>) => tool('runtime.agents.start').run(ctx, args) as Promise<Result>;
    expect(await start({ ...START_ARGS, agentId: 'Triage Bot!' })).toMatchObject({ ok: false, code: 'invalid-agent-id' });
    expect(await start({ ...START_ARGS, task: 'x'.repeat(RUNTIME_AGENT_TASK_MAX_LENGTH + 1) })).toMatchObject({ ok: false, code: 'invalid-argument' });
    await expect(start({ projectId: PROJECT_ID, agentId: 'triage' })).rejects.toThrow(/task/);
    expect(port.start).not.toHaveBeenCalled();
  });

  it('start refuses an undeclared agent and an invalid manifest', async () => {
    const port = stubPort();
    const undeclared = setup(withAgent({ role: 'developer' }), port).tool('runtime.agents.start');
    expect(await undeclared.run(ctx, { ...START_ARGS, agentId: 'other' })).toMatchObject({ ok: false, code: 'agent-not-declared' });
    const invalid = setup({ version: 1, services: { web: { port: 3000 } } }, port).tool('runtime.agents.start');
    expect(await invalid.run(ctx, START_ARGS)).toMatchObject({ ok: false, code: 'manifest-invalid' });
    expect(port.start).not.toHaveBeenCalled();
  });

  it('answers runtime-unavailable on every run tool when no port is wired, after validation', async () => {
    const { tool } = setup(withAgent({ role: 'developer', tools: ['env.fs.read'] }));
    const calls: Array<[string, Record<string, unknown>]> = [
      ['start', START_ARGS],
      ['status', { projectId: PROJECT_ID, runId: 'run-1' }],
      ['steer', { projectId: PROJECT_ID, runId: 'run-1', message: 'hi' }],
      ['cancel', { projectId: PROJECT_ID, runId: 'run-1' }],
    ];
    for (const [name, args] of calls) {
      expect(await tool(`runtime.agents.${name}`).run(ctx, args)).toMatchObject({ ok: false, code: 'runtime-unavailable' });
    }
    // Validation still applies first: a bad agent id is its own refusal, not runtime-unavailable.
    expect(await tool('runtime.agents.start').run(ctx, { ...START_ARGS, agentId: 'NOPE' })).toMatchObject({ code: 'invalid-agent-id' });
  });

  it('starts a declared agent through the port with its role, never a model id', async () => {
    const port = stubPort();
    const { tool } = setup(withAgent({ role: 'developer', tools: ['env.fs.read', 'tasks.list'] }), port);
    const r = (await tool('runtime.agents.start').run(ctx, START_ARGS)) as Result;
    expect(r).toMatchObject({ ok: true, runId: 'run-1', agentId: 'triage', role: 'developer' });
    expect(port.start).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      agentId: 'triage',
      task: 'triage the backlog',
      role: 'developer',
      tools: ['env.fs.read', 'tasks.list'],
    });
  });

  it('dispatches status, steer and cancel to the port scoped to the project', async () => {
    const port = stubPort();
    const { tool } = setup(withAgent({ role: 'developer' }), port);
    const scope = { projectId: PROJECT_ID };
    expect(await tool('runtime.agents.status').run(ctx, { projectId: PROJECT_ID, runId: 'run-1' })).toMatchObject({ ok: true, result: { state: 'thinking' } });
    await tool('runtime.agents.steer').run(ctx, { projectId: PROJECT_ID, runId: 'run-1', message: 'focus on bugs' });
    await tool('runtime.agents.cancel').run(ctx, { projectId: PROJECT_ID, runId: 'run-1' });
    expect(port.status).toHaveBeenCalledWith('run-1', scope);
    expect(port.steer).toHaveBeenCalledWith('run-1', 'focus on bugs', scope);
    expect(port.cancel).toHaveBeenCalledWith('run-1', scope);
  });
});
