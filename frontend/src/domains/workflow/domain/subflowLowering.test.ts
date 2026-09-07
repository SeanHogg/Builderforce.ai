import { describe, expect, it } from 'vitest';
import { compileBoardFlow } from './compileBoardFlow';
import type { BoardFlowConnection, BoardFlowObject } from './boardFlow';
import type { SubflowBoard, SubflowResolver } from './subflow';

/**
 * COMPOSITION, COMPILED.
 *
 * The cases that matter are the refusals. A nested canvas that compiles to nothing
 * would be a step that runs, reports success and does not do the work — so every
 * way a child can fail to be runnable has to stop the parent build and SAY which
 * canvas, and each of those is asserted here.
 */

function step(id: string, data: Record<string, unknown>, x = 0): BoardFlowObject {
  return { id, position: { x, y: 0 }, data: { kind: 'flowStep', title: id, ...data } };
}

function link(source: string, target: string): BoardFlowConnection {
  return { id: `${source}->${target}`, source, target };
}

function subflow(id: string, config: Record<string, unknown>, x = 0): BoardFlowObject {
  return step(id, { stepKind: 'subflow', stepConfig: config }, x);
}

function board(
  sessionId: string,
  objects: BoardFlowObject[],
  connections: BoardFlowConnection[] = [],
  definitionId: string | null = null,
): SubflowBoard {
  return { sessionId, title: `Canvas ${sessionId}`, objects, connections, definitionId };
}

function resolver(...boards: SubflowBoard[]): SubflowResolver {
  const bySession = new Map(boards.map((entry) => [entry.sessionId, entry]));
  return (sessionId) => bySession.get(sessionId) ?? null;
}

const OFFBOARD = board('offboard', [
  step('revoke', { stepKind: 'llm', stepConfig: { prompt: 'Revoke access for {{input}}' } }),
  step('payroll', { stepKind: 'llm', stepConfig: { prompt: 'Final payroll for {{input}}' } }, 200),
], [link('revoke', 'payroll')], 'def-offboard');

describe('a nested canvas, snapshot-bound', () => {
  it('inlines the child between a pass-through at each end', () => {
    const result = compileBoardFlow(
      [subflow('nest', { canvasSessionId: 'offboard' })],
      [],
      { resolveSubflow: resolver(OFFBOARD) },
    );

    expect(result.issues).toEqual([]);
    expect(result.definition.nodes.map((node) => node.id)).toEqual([
      'trigger', 'nest', 'nest~revoke', 'nest~payroll', 'nest:exit',
    ]);
    // The child's own steps keep their kinds; the boundary is a pass-through.
    expect(result.definition.nodes.find((node) => node.id === 'nest')?.kind).toBe('transform');
    expect(result.definition.nodes.find((node) => node.id === 'nest~revoke')?.kind).toBe('llm');
    const edges = result.definition.edges.map((edge) => `${edge.source}->${edge.target}`);
    expect(edges).toContain('nest->nest~revoke');
    expect(edges).toContain('nest~revoke->nest~payroll');
    expect(edges).toContain('nest~payroll->nest:exit');
  });

  it('keeps the parent flow wired through the child', () => {
    const result = compileBoardFlow(
      [
        step('before', { stepKind: 'llm', stepConfig: { prompt: 'Pick the leaver' } }),
        subflow('nest', { canvasSessionId: 'offboard' }, 200),
        step('after', { stepKind: 'llm', stepConfig: { prompt: 'Tell the team' } }, 400),
      ],
      [link('before', 'nest'), link('nest', 'after')],
      { resolveSubflow: resolver(OFFBOARD) },
    );

    const edges = result.definition.edges.map((edge) => `${edge.source}->${edge.target}`);
    // In at the entry, on from the EXIT — not from the entry, which would skip the
    // whole child while still looking connected.
    expect(edges).toContain('before->nest');
    expect(edges).toContain('nest:exit->after');
    expect(edges).not.toContain('nest->after');
  });

  it('maps declared inputs in front of the child and captures its outputs after it', () => {
    const result = compileBoardFlow(
      [subflow('nest', { canvasSessionId: 'offboard' })].map((object) => ({
        ...object,
        data: { ...object.data, stepInputs: [{ key: 'employee', from: 'person' }], stepOutputs: [{ key: 'settlement', from: 'total' }] },
      })),
      [],
      { resolveSubflow: resolver(OFFBOARD) },
    );

    const edges = result.definition.edges.map((edge) => `${edge.source}->${edge.target}`);
    expect(edges).toContain('nest:in->nest');
    expect(edges).toContain('nest:exit->nest:out');
    expect(result.definition.nodes.find((node) => node.id === 'nest:out')?.kind).toBe('set-variables');
  });

  it('drops the child’s own trigger and feeds what it fed', () => {
    const withTrigger = board('scheduled', [
      step('tick', { stepKind: 'trigger', stepConfig: { triggerType: 'schedule' } }),
      step('work', { stepKind: 'llm', stepConfig: { prompt: 'Do it' } }, 200),
    ], [link('tick', 'work')]);

    const result = compileBoardFlow(
      [subflow('nest', { canvasSessionId: 'scheduled' })],
      [],
      { resolveSubflow: resolver(withTrigger) },
    );

    expect(result.definition.nodes.map((node) => node.id)).not.toContain('nest~tick');
    expect(result.definition.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain('nest->nest~work');
  });

  it('still gives the PARENT a start when the only trigger came from a child', () => {
    const withTrigger = board('scheduled', [
      step('tick', { stepKind: 'trigger', stepConfig: { triggerType: 'schedule' } }),
      step('work', { stepKind: 'llm', stepConfig: { prompt: 'Do it' } }, 200),
    ], [link('tick', 'work')]);

    const result = compileBoardFlow(
      [subflow('nest', { canvasSessionId: 'scheduled' })],
      [],
      { resolveSubflow: resolver(withTrigger) },
    );

    // Without this the board would have no entry point at all — a flow that
    // builds green and can never start.
    expect(result.definition.nodes[0]).toMatchObject({ id: 'trigger', kind: 'trigger' });
    expect(result.definition.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain('trigger->nest');
  });

  it('nests two levels deep', () => {
    const middle = board('middle', [subflow('inner', { canvasSessionId: 'offboard' })]);
    const result = compileBoardFlow(
      [subflow('outer', { canvasSessionId: 'middle' })],
      [],
      { resolveSubflow: resolver(middle, OFFBOARD) },
    );
    expect(result.issues).toEqual([]);
    expect(result.definition.nodes.map((node) => node.id)).toContain('outer~inner~revoke');
  });
});

describe('a nested canvas, live-bound', () => {
  it('compiles to one node carrying the child’s own definition', () => {
    const result = compileBoardFlow(
      [subflow('nest', { canvasSessionId: 'offboard', binding: 'live' })],
      [],
      { resolveSubflow: resolver(OFFBOARD) },
    );
    expect(result.issues).toEqual([]);
    const node = result.definition.nodes.find((candidate) => candidate.id === 'nest');
    expect(node?.kind).toBe('subflow');
    expect(node?.config).toMatchObject({ definitionId: 'def-offboard', canvas: 'Canvas offboard' });
    // No child steps inlined: they are resolved when the run is instantiated.
    expect(result.definition.nodes.map((candidate) => candidate.id)).toEqual(['trigger', 'nest']);
  });

  it('refuses a canvas that has never been built', () => {
    const unbuilt = board('draft', [step('work', { stepKind: 'llm', stepConfig: { prompt: 'Do it' } })]);
    const result = compileBoardFlow(
      [subflow('nest', { canvasSessionId: 'draft', binding: 'live' })],
      [],
      { resolveSubflow: resolver(unbuilt) },
    );
    expect(result.issues[0]).toMatchObject({ objectId: 'nest', messageKey: 'subflowNeedsBuild' });
    expect(result.definition.nodes).toEqual([]);
  });
});

describe('a nested canvas that cannot run', () => {
  it('refuses a step with no canvas chosen', () => {
    const result = compileBoardFlow([subflow('nest', {})], [], { resolveSubflow: resolver() });
    expect(result.issues[0]).toMatchObject({ messageKey: 'subflowNeedsCanvas' });
  });

  it('refuses a canvas it cannot read, and names it', () => {
    const result = compileBoardFlow(
      [subflow('nest', { canvasSessionId: 'gone', canvasTitle: 'Offboarding' })],
      [],
      { resolveSubflow: resolver() },
    );
    expect(result.issues[0]).toMatchObject({ messageKey: 'subflowUnresolved', values: { canvas: 'Offboarding' } });
  });

  it('refuses a board that reaches itself', () => {
    const self = board('self', [subflow('nest', { canvasSessionId: 'self' })]);
    const result = compileBoardFlow(self.objects, self.connections, {
      resolveSubflow: resolver(self),
      // The surface seeds the stack with the canvas being compiled, which is what
      // makes a DIRECT self-reference a cycle rather than one recursion first.
      stack: ['self'],
    });
    expect(result.issues[0]).toMatchObject({ messageKey: 'subflowCycle' });
  });

  it('refuses a canvas with no steps', () => {
    const empty = board('empty', []);
    const result = compileBoardFlow([subflow('nest', { canvasSessionId: 'empty' })], [], { resolveSubflow: resolver(empty) });
    expect(result.issues[0]).toMatchObject({ messageKey: 'subflowEmpty' });
  });

  it('refuses a canvas holding a step that is not ready, and says which', () => {
    const broken = board('broken', [step('draft', { stepKind: 'llm', stepConfig: {} })]);
    const result = compileBoardFlow([subflow('nest', { canvasSessionId: 'broken' })], [], { resolveSubflow: resolver(broken) });
    expect(result.issues[0]).toMatchObject({ messageKey: 'subflowNotBuildable', values: { canvas: 'Canvas broken', step: 'draft' } });
  });

  it('refuses composition deeper than the limit', () => {
    // Seven canvases, each nesting the next: the sixth lowering is the one that
    // runs with a full stack, which is one past MAX_SUBFLOW_DEPTH.
    const chain = Array.from({ length: 7 }, (_, index) => board(
      `level${index}`,
      index === 6
        ? [step('work', { stepKind: 'llm', stepConfig: { prompt: 'Do it' } })]
        : [subflow('nest', { canvasSessionId: `level${index + 1}` })],
    ));
    const result = compileBoardFlow(chain[0]!.objects, [], { resolveSubflow: resolver(...chain) });
    // The refusal surfaces at the top as the outermost child not being buildable;
    // what matters is that it REFUSES rather than recursing without bound.
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.definition.nodes).toEqual([]);
  });
});
