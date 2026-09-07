import { describe, expect, it } from 'vitest';
import { expandSubflows, type SubflowDefinitionLoader } from './expandSubflows';
import type { WorkflowDefinition, WorkflowNodeKind } from '../../domain/workflowGraph';

function node(id: string, kind: WorkflowNodeKind, config: Record<string, unknown> = {}) {
  return { id, kind, label: id, position: { x: 0, y: 0 }, config };
}

function edge(source: string, target: string, label?: string) {
  return { id: `${source}->${target}`, source, target, ...(label ? { label } : {}) };
}

function loader(definitions: Record<string, WorkflowDefinition>): SubflowDefinitionLoader {
  return async (definitionId) => {
    const definition = definitions[definitionId];
    return definition ? { name: `Canvas ${definitionId}`, definition } : null;
  };
}

const CHILD: WorkflowDefinition = {
  nodes: [node('start', 'trigger'), node('revoke', 'llm'), node('payroll', 'llm')],
  edges: [edge('start', 'revoke'), edge('revoke', 'payroll')],
};

describe('expandSubflows', () => {
  it('leaves a definition with no nested canvas exactly as it was', async () => {
    const definition: WorkflowDefinition = { nodes: [node('a', 'llm')], edges: [] };
    const result = await expandSubflows(definition, loader({}));
    expect(result).toEqual({ ok: true, definition, expanded: 0 });
  });

  it('splices the child in and drops its own trigger', async () => {
    const parent: WorkflowDefinition = {
      nodes: [node('t', 'trigger'), node('nest', 'subflow', { definitionId: 'child', canvas: 'Offboarding' })],
      edges: [edge('t', 'nest')],
    };
    const result = await expandSubflows(parent, loader({ child: CHILD }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = result.definition.nodes.map((entry) => entry.id);
    expect(ids).toEqual(['t', 'nest', 'nest~revoke', 'nest~payroll', 'nest:exit']);
    // The child's trigger is that child's entry point; inlined it could never fire.
    expect(ids).not.toContain('nest~start');
    expect(result.expanded).toBe(1);
  });

  it('sends what came after the step out of the child’s exit, not its entry', async () => {
    const parent: WorkflowDefinition = {
      nodes: [node('nest', 'subflow', { definitionId: 'child' }), node('after', 'llm')],
      edges: [edge('nest', 'after', 'done')],
    };
    const result = await expandSubflows(parent, loader({ child: CHILD }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const onward = result.definition.edges.find((entry) => entry.target === 'after');
    expect(onward?.source).toBe('nest:exit');
    // A labeled edge keeps its label: the outlet the author drew still prunes.
    expect(onward?.label).toBe('done');
    // And the child's first step still hangs off the ENTRY.
    expect(result.definition.edges.some((entry) => entry.source === 'nest' && entry.target === 'nest~revoke')).toBe(true);
  });

  it('expands a child that itself nests another canvas', async () => {
    const middle: WorkflowDefinition = { nodes: [node('inner', 'subflow', { definitionId: 'child' })], edges: [] };
    const parent: WorkflowDefinition = { nodes: [node('outer', 'subflow', { definitionId: 'middle' })], edges: [] };
    const result = await expandSubflows(parent, loader({ middle, child: CHILD }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes.map((entry) => entry.id)).toContain('outer~inner~revoke');
    expect(result.expanded).toBe(2);
  });

  it('refuses a definition it cannot read rather than running without it', async () => {
    const parent: WorkflowDefinition = {
      nodes: [node('nest', 'subflow', { definitionId: 'deleted', canvas: 'Offboarding' })],
      edges: [],
    };
    const result = await expandSubflows(parent, loader({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Offboarding');
  });

  it('refuses a step whose canvas was never built', async () => {
    const parent: WorkflowDefinition = { nodes: [node('nest', 'subflow', { canvas: 'Offboarding' })], edges: [] };
    const result = await expandSubflows(parent, loader({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('never been built');
  });

  it('refuses a canvas that runs itself', async () => {
    const recursive: WorkflowDefinition = { nodes: [node('nest', 'subflow', { definitionId: 'loop' })], edges: [] };
    const result = await expandSubflows(recursive, loader({ loop: recursive }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('runs itself');
  });

  it('refuses a canvas with nothing in it', async () => {
    const parent: WorkflowDefinition = { nodes: [node('nest', 'subflow', { definitionId: 'empty' })], edges: [] };
    const result = await expandSubflows(parent, loader({ empty: { nodes: [node('t', 'trigger')], edges: [] } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('no steps');
  });
});
