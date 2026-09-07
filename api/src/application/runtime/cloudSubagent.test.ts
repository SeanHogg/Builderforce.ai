import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry, type Capability, type CapabilityProvider, type ToolDefinition } from '@builderforce/agent-tools';
import type { LoopTurnResult } from '@builderforce/agent-loop';
import { buildOrchestrationCapability, childCapabilities, MUTATING_CAPABILITIES, NON_DELEGABLE_CAPABILITIES } from './cloudSubagent';

/**
 * What a child may TOUCH is the whole of this module's job — the run itself belongs to
 * the shared kernel. So the capability boundary is tested directly (it is a security
 * boundary, and a set-difference bug there is silent), and the spawn path is tested for
 * the two things a parent's run depends on: a child's failure is information rather
 * than a dead run, and a cancel is not mistaken for one.
 */

const ALL_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  'repo.read', 'repo.search', 'repo.write', 'repo.edit', 'repo.delete', 'shell',
  'human', 'memory', 'memory.forget', 'coordinate', 'prd.write', 'web', 'web.search',
  'skill.author', 'orchestrate',
]);

const answer = (content: string): LoopTurnResult => ({ content, toolCalls: [] });

function registryWith(...defs: ToolDefinition[]): ToolRegistry {
  return new ToolRegistry(defs);
}

const readTool: ToolDefinition = {
  name: 'read_file',
  requires: ['repo.read'],
  schema: { type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object' } } },
  execute: async () => ({ data: { ok: true, content: 'hello' } }),
};
const writeTool: ToolDefinition = {
  name: 'write_file',
  requires: ['repo.write'],
  schema: { type: 'function', function: { name: 'write_file', description: 'write', parameters: { type: 'object' } } },
  execute: async () => ({ data: { ok: true } }),
};

function provider(caps: ReadonlySet<Capability>): CapabilityProvider {
  return { capabilities: caps };
}

describe('childCapabilities', () => {
  it('never lets a child spawn — recursion is impossible by construction', () => {
    expect([...childCapabilities(ALL_CAPS, false)]).not.toContain('orchestrate');
    expect([...childCapabilities(ALL_CAPS, true)]).not.toContain('orchestrate');
  });

  it('never lets a child pause the run for a human', () => {
    expect([...childCapabilities(ALL_CAPS, false)]).not.toContain('human');
  });

  it('withholds every mutating capability from the default read-only child', () => {
    const caps = childCapabilities(ALL_CAPS, true);
    for (const c of MUTATING_CAPABILITIES) expect([...caps]).not.toContain(c);
    // …while leaving it everything it needs to investigate.
    expect([...caps]).toEqual(expect.arrayContaining(['repo.read', 'repo.search', 'memory', 'web.search']));
  });

  it('keeps the mutating half for an explicitly writable child', () => {
    const caps = childCapabilities(ALL_CAPS, false);
    expect([...caps]).toEqual(expect.arrayContaining(['repo.write', 'repo.edit', 'shell']));
    // The structural exclusions still hold — writable is not unrestricted.
    for (const c of NON_DELEGABLE_CAPABILITIES) expect([...caps]).not.toContain(c);
  });

  it('is a subset of the parent — a child can never gain what the surface lacks', () => {
    const narrow: ReadonlySet<Capability> = new Set<Capability>(['repo.read']);
    expect([...childCapabilities(narrow, false)]).toEqual(['repo.read']);
  });
});

describe('buildOrchestrationCapability', () => {
  const deps = (over: Partial<Parameters<typeof buildOrchestrationCapability>[0]> = {}) =>
    buildOrchestrationCapability({
      parentCaps: ALL_CAPS,
      provider: provider(ALL_CAPS),
      registry: registryWith(readTool, writeTool),
      complete: async () => answer('done'),
      ...over,
    });

  it('advertises only the tools the child\'s narrowed capabilities back', async () => {
    const complete = vi.fn(async () => answer('found'));
    await deps({ complete }).spawn({ label: 'look', task: 'find it' });
    const advertised = complete.mock.calls[0]![0].tools.map((t) => t.function.name);
    expect(advertised).toContain('read_file');
    expect(advertised).not.toContain('write_file');
  });

  it('gives a writable child the write tool', async () => {
    const complete = vi.fn(async () => answer('changed'));
    await deps({ complete }).spawn({ label: 'edit', task: 'change it', readOnly: false });
    expect(complete.mock.calls[0]![0].tools.map((t) => t.function.name)).toContain('write_file');
  });

  it('returns the child\'s answer with what it cost', async () => {
    const result = await deps().spawn({ label: 'look', task: 'find it' });
    expect(result).toMatchObject({ ok: true, output: 'done', steps: 1 });
  });

  it('reports a failed child to the parent instead of ending its run', async () => {
    const result = await deps({
      complete: async () => { throw new Error('gateway exploded'); },
    }).spawn({ label: 'look', task: 'find it' });
    expect(result).toMatchObject({ ok: false, error: 'gateway exploded' });
  });

  it('rethrows when the parent run was cancelled — a killed child is not a failed tool', async () => {
    const controller = new AbortController();
    const capability = deps({
      signal: controller.signal,
      complete: async () => { controller.abort(); throw new Error('aborted'); },
    });
    await expect(capability.spawn({ label: 'look', task: 'find it' })).rejects.toThrow('aborted');
  });

  it('records the delegation on the timeline so it is not an unexplained gap', async () => {
    const record = vi.fn(async () => {});
    await deps({ record }).spawn({ label: 'find the middleware', task: 'find it' });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toMatchObject({ label: 'find the middleware' });
    expect(record.mock.calls[0]![0].detail).toMatchObject({ readOnly: true, steps: 1 });
  });

  it('hands the child no spawner of its own', async () => {
    // A child provider carrying the parent's orchestration would leave a second route
    // to recursion open behind the capability gate.
    let seen: CapabilityProvider | undefined;
    const parent: CapabilityProvider = {
      capabilities: ALL_CAPS,
      orchestration: { spawn: async () => ({ ok: true }) },
    };
    const registry = registryWith({
      ...readTool,
      execute: async (_args, ctx) => { seen = ctx.caps; return { data: { ok: true } }; },
    });
    let turn = 0;
    await buildOrchestrationCapability({
      parentCaps: ALL_CAPS,
      provider: parent,
      registry,
      complete: async () => (turn++ === 0
        ? { content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{}' }] }
        : answer('done')),
    }).spawn({ label: 'look', task: 'find it' });

    expect(seen).toBeDefined();
    expect(seen!.orchestration).toBeUndefined();
  });
});
