import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry, type Capability, type CapabilityProvider, type ToolDefinition, type ToolSchema } from '@builderforce/agent-tools';
import type { LoopTurnResult } from '@builderforce/agent-loop';
import { buildOrchestrationCapability, childCapabilities, imageHostedChildCeiling, MUTATING_CAPABILITIES, NON_DELEGABLE_CAPABILITIES } from './cloudSubagent';
import { CONTAINER_SURFACE_CAPS } from './cloudAgentTools';

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

/** The shape the child's model port is called with — spelled out so a mock's
 *  recorded call has a type to read. */
type CompleteArgs = { messages: Record<string, unknown>[]; tools: ToolSchema[]; step: number };
type RecordArgs = { label: string; detail: Record<string, unknown>; result: string };

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
    const complete = vi.fn(async (_args: CompleteArgs) => answer('found'));
    await deps({ complete }).spawn({ label: 'look', task: 'find it' });
    const advertised = complete.mock.calls[0]![0].tools.map((t) => t.function.name);
    expect(advertised).toContain('read_file');
    expect(advertised).not.toContain('write_file');
  });

  it('gives a writable child the write tool', async () => {
    const complete = vi.fn(async (_args: CompleteArgs) => answer('changed'));
    await deps({ complete }).spawn({ label: 'edit', task: 'change it', readOnly: false });
    expect(complete.mock.calls[0]![0].tools.map((t) => t.function.name)).toContain('write_file');
  });

  it('returns the child\'s answer with what it cost', async () => {
    const result = await deps().spawn({ label: 'look', task: 'find it' });
    // A child that answers on its first turn stopped at step 0 — `steps` is the turn it
    // stopped on, which is what the delegation cost.
    expect(result).toMatchObject({ ok: true, output: 'done', steps: 0 });
  });

  it('reports a failed child to the parent instead of ending its run', async () => {
    const result = await deps({
      complete: async () => { throw new Error('gateway exploded'); },
    }).spawn({ label: 'look', task: 'find it' });
    expect(result).toMatchObject({ ok: false, error: 'gateway exploded' });
  });

  it('names cancellation as cancellation, not as a child that failed', async () => {
    // The kernel absorbs an aborted fetch into `cancelled` rather than letting it
    // escape, so this returns rather than throws. It must still be distinguishable
    // from a child that genuinely could not answer — the parent's own cancel check
    // ends the run at the next step boundary either way, but the timeline should not
    // read "the sub-agent failed" when the user pressed stop.
    const controller = new AbortController();
    const result = await deps({
      signal: controller.signal,
      complete: async () => { controller.abort(); throw new Error('aborted'); },
    }).spawn({ label: 'look', task: 'find it' });
    expect(result).toMatchObject({ ok: false, error: 'the run was cancelled while this sub-agent was working' });
  });

  it('rethrows a failure that escapes the kernel while the run is aborting', async () => {
    // Everything the kernel catches becomes `cancelled` above. A throw from OUTSIDE it
    // — resolving the tool schemas, the registry itself — is not the child's failure to
    // report, so it goes back to the parent's kernel rather than becoming a tool result.
    const controller = new AbortController();
    controller.abort();
    const capability = deps({
      signal: controller.signal,
      registry: { schemasForCapabilities: () => { throw new Error('registry gone'); } } as never,
    });
    await expect(capability.spawn({ label: 'look', task: 'find it' })).rejects.toThrow('registry gone');
  });

  it('records the delegation on the timeline so it is not an unexplained gap', async () => {
    const record = vi.fn(async (_event: RecordArgs) => {});
    await deps({ record }).spawn({ label: 'find the middleware', task: 'find it' });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toMatchObject({ label: 'find the middleware' });
    expect(record.mock.calls[0]![0].detail).toMatchObject({ readOnly: true, steps: 0 });
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

describe('imageHostedChildCeiling', () => {
  /**
   * A child commissioned by the container or the Actions runner does NOT run in that
   * image — it runs in the Worker. So the parent's set cannot be inherited verbatim,
   * and the two ways to get that wrong are opposite: hand over a capability this host
   * cannot back, or narrow so hard the child cannot do the job it was delegated.
   */
  it('drops `shell`, which no Worker can back', () => {
    // The failure this prevents: a child offered `run_command` with nothing behind it.
    expect(CONTAINER_SURFACE_CAPS.has('shell')).toBe(true);
    expect(imageHostedChildCeiling(CONTAINER_SURFACE_CAPS).has('shell')).toBe(false);
  });

  it('translates the shell into `repo.search`, so a delegated investigation can search', () => {
    // An image parent greps its clone THROUGH the shell, which is the only reason
    // `repo.search` is absent from its set. Dropping the shell without this would leave
    // a child unable to search at all — and searching is most of what delegation is for.
    expect(CONTAINER_SURFACE_CAPS.has('repo.search')).toBe(false);
    expect(imageHostedChildCeiling(CONTAINER_SURFACE_CAPS).has('repo.search')).toBe(true);
  });

  it('grants nothing the parent did not already hold', () => {
    // `repo.search` is the ONE addition, and only as the read half of a shell the
    // parent has. A ceiling that grew any other way would be an escalation.
    const parent = CONTAINER_SURFACE_CAPS;
    const extra = [...imageHostedChildCeiling(parent)].filter((c) => !parent.has(c));
    expect(extra).toEqual(['repo.search']);
  });

  it('adds no search capability to a parent that has no shell', () => {
    const ceiling = imageHostedChildCeiling(new Set<Capability>(['repo.read', 'memory']));
    expect(ceiling.has('repo.search')).toBe(false);
    expect([...ceiling].sort()).toEqual(['memory', 'repo.read']);
  });

  it('still yields a child that cannot spawn, once the withheld set is applied', () => {
    // The structural invariant has to survive the new ceiling: recursion stays
    // impossible by construction, not by a depth counter.
    const child = childCapabilities(imageHostedChildCeiling(CONTAINER_SURFACE_CAPS), false);
    expect(child.has('orchestrate')).toBe(false);
    expect(child.has('human')).toBe(false);
  });

  it('gives a WRITABLE child the repo write the parent holds, and a read-only one none', () => {
    const ceiling = imageHostedChildCeiling(CONTAINER_SURFACE_CAPS);
    expect(childCapabilities(ceiling, false).has('repo.write')).toBe(true);
    expect(childCapabilities(ceiling, true).has('repo.write')).toBe(false);
  });
});
