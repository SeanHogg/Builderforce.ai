import { describe, expect, it } from 'vitest';
import { compileStage, encodeAgentRole, type StageAssignment } from './compileStage';

function a(partial: Partial<StageAssignment> & { id: string; role: string }): StageAssignment {
  return {
    runtime: 'local',
    target: null,
    taskTemplate: null,
    position: 0,
    ...partial,
  };
}

describe('encodeAgentRole', () => {
  it('keeps a bare role for local runtime', () => {
    expect(encodeAgentRole('implementer', 'local')).toBe('implementer');
  });

  it('prefixes cloud runtime with remote:cloud when no target given', () => {
    expect(encodeAgentRole('reviewer', 'cloud')).toBe('remote:cloud:reviewer');
  });

  it('uses an explicit target for cloud runtime', () => {
    expect(encodeAgentRole('reviewer', 'cloud', 'fleet-7')).toBe('remote:fleet-7:reviewer');
  });

  it('prefixes remote runtime with the target agentHost id', () => {
    expect(encodeAgentRole('tester', 'remote', 'agentHost-42')).toBe('remote:agentHost-42:tester');
  });

  it('emits an unassigned marker for remote runtime missing a target', () => {
    expect(encodeAgentRole('tester', 'remote')).toBe('remote:unassigned:tester');
  });
});

describe('compileStage — parallel', () => {
  const assignments: StageAssignment[] = [
    a({ id: 'x1', role: 'implementer', position: 0 }),
    a({ id: 'x2', role: 'reviewer', position: 1 }),
    a({ id: 'x3', role: 'tester', position: 2 }),
  ];

  it('gives every spec an empty dependsOn', () => {
    const specs = compileStage(assignments, 'parallel', 'build');
    expect(specs).toHaveLength(3);
    for (const s of specs) expect(s.dependsOn).toEqual([]);
  });

  it('preserves assignment ids as spec ids', () => {
    const specs = compileStage(assignments, 'parallel', 'build');
    expect(specs.map((s) => s.id)).toEqual(['x1', 'x2', 'x3']);
  });
});

describe('compileStage — sequential', () => {
  const assignments: StageAssignment[] = [
    a({ id: 's1', role: 'implementer', position: 0 }),
    a({ id: 's2', role: 'reviewer', position: 1 }),
    a({ id: 's3', role: 'tester', position: 2 }),
  ];

  it('chains each task to the previous one; first has no deps', () => {
    const specs = compileStage(assignments, 'sequential', 'qa');
    expect(specs[0]!.dependsOn).toEqual([]);
    expect(specs[1]!.dependsOn).toEqual(['s1']);
    expect(specs[2]!.dependsOn).toEqual(['s2']);
  });
});

describe('compileStage — ordering and uniqueness', () => {
  it('sorts by position then id before compiling', () => {
    const specs = compileStage(
      [
        a({ id: 'b', role: 'r', position: 2 }),
        a({ id: 'a', role: 'r', position: 1 }),
        a({ id: 'c', role: 'r', position: 1 }),
      ],
      'sequential',
      'lane',
    );
    // position 1: a then c (id tiebreak), then position 2: b
    expect(specs.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(specs[0]!.dependsOn).toEqual([]);
    expect(specs[1]!.dependsOn).toEqual(['a']);
    expect(specs[2]!.dependsOn).toEqual(['c']);
  });

  it('produces unique descriptions even when roles and templates collide', () => {
    const specs = compileStage(
      [
        a({ id: 'd1', role: 'dev', position: 0, taskTemplate: 'do the thing' }),
        a({ id: 'd2', role: 'dev', position: 0, taskTemplate: 'do the thing' }),
        a({ id: 'd3', role: 'dev', position: 0, taskTemplate: 'do the thing' }),
      ],
      'parallel',
      'same',
    );
    const descs = specs.map((s) => s.description);
    expect(new Set(descs).size).toBe(descs.length);
  });

  it('encodes runtime into the agentRole of each spec', () => {
    const specs = compileStage(
      [
        a({ id: 'r1', role: 'impl', runtime: 'local', position: 0 }),
        a({ id: 'r2', role: 'rev', runtime: 'remote', target: 'agentHost-9', position: 1 }),
        a({ id: 'r3', role: 'qa', runtime: 'cloud', position: 2 }),
      ],
      'parallel',
      'mix',
    );
    expect(specs[0]!.agentRole).toBe('impl');
    expect(specs[1]!.agentRole).toBe('remote:agentHost-9:rev');
    expect(specs[2]!.agentRole).toBe('remote:cloud:qa');
  });

  it('falls back to a generated description when no template is provided', () => {
    const specs = compileStage([a({ id: 'g1', role: 'planner', position: 0 })], 'parallel', 'plan');
    expect(specs[0]!.description).toContain('planner');
    expect(specs[0]!.description).toContain('plan');
  });

  it('returns an empty list for no assignments', () => {
    expect(compileStage([], 'sequential', 'empty')).toEqual([]);
  });
});
