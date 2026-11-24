import { describe, expect, it } from 'vitest';
import { prepareChildStart } from '@builderforce/agent-run';
import { childBrief, childHandle, childIdOf, childPayload, isSubagentRun, parseCloudChild, withCloudChildHandle, type CloudChildSpec } from './cloudChildSpec';

/** A cloud sub-agent is its own durable run with an owner pointer — the payload carries who it is. */

const spec: CloudChildSpec = {
  parentExecutionId: 41,
  rootExecutionId: 40,
  depth: 2,
  handle: 'a42',
  label: 'port auth',
  task: 'Move the auth middleware to src/auth.',
  owner: 'Ada',
};

describe('child payload', () => {
  it('adds the assigned handle without dropping policy stamped at admission', () => {
    const admitted = {
      subagent: { ...spec, handle: '' },
      lifecycleNeutral: true,
      policyGates: [{ id: 'new-tenant-gate', effect: 'block', tool: 'write_file' }],
    };
    expect(JSON.parse(withCloudChildHandle(JSON.stringify(admitted), 'a42'))).toEqual({
      ...admitted, executor: 'durable', subagent: { ...admitted.subagent, handle: 'a42' },
    });
  });

  it('inherits only the routing of its owner and carries its own spec', () => {
    const parent = JSON.stringify({ chatId: 7, cloudAgentRef: 'ag_1', model: 'm', followUp: { directive: 'x' }, reviewRole: 'qa' });
    const out = JSON.parse(childPayload(parent, spec)) as Record<string, unknown>;
    expect(out).toMatchObject({ chatId: 7, cloudAgentRef: 'ag_1', model: 'm', executor: 'durable', lifecycleNeutral: true });
    expect(out.followUp).toBeUndefined();
    expect(out.reviewRole).toBeUndefined();
    expect(parseCloudChild(JSON.stringify(out))).toEqual(spec);
  });

  it('tells a sub-agent run apart from every other run', () => {
    expect(isSubagentRun(childPayload(undefined, spec))).toBe(true);
    expect(isSubagentRun(JSON.stringify({ chatId: 7 }))).toBe(false);
    expect(isSubagentRun('not json')).toBe(false);
    expect(isSubagentRun(null)).toBe(false);
  });
});

describe('child handle', () => {
  it('round-trips through the execution id', () => {
    expect(childHandle(42)).toBe('a42');
    expect(childIdOf('a42')).toBe(42);
    expect(childIdOf('b42')).toBeNull();
  });
});

describe('child brief', () => {
  it('uses the admitted instructions after payload round-trip instead of resolving the persona again', () => {
    const prepared = prepareChildStart({
      parentRunId: '41', entryPoint: 'cloud', depth: 2,
      owner: 'Ada', task: spec.task, persona: { name: 'Grace', brief: 'ADMITTED PERSONA' },
    });
    const admitted = parseCloudChild(childPayload(undefined, {
      ...spec, standingPrompt: prepared.systemPrompt, entryPoint: prepared.entryPoint,
    }))!;
    const brief = childBrief({ ...admitted, persona: { name: 'Changed', brief: 'LATER PERSONA' } }, 'TICK BASE');
    expect(brief.systemPrompt).toContain('ADMITTED PERSONA');
    expect(brief.systemPrompt).not.toContain('LATER PERSONA');
    expect(brief.systemPrompt.endsWith('\n\nTICK BASE')).toBe(true);
    expect(brief.userContent).toBe(spec.task);
  });

  it('puts the live sub-agent rules in front of the owner prompt and the task as the first turn', () => {
    const { systemPrompt, userContent } = childBrief(spec, 'BASE PROMPT');
    expect(systemPrompt).toContain('spawned by Ada');
    expect(systemPrompt.endsWith('BASE PROMPT')).toBe(true);
    expect(userContent).toBe('Move the auth middleware to src/auth.');
    expect(systemPrompt).toContain('carry out your slice end to end');
  });
});
