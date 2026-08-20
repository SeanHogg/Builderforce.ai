/**
 * Labeled edges — the thing that makes a `branch` node actually branch.
 *
 * `branch` and `router` tagged their payload with the outlet taken, and nothing
 * read it: both sides of every branch ran, and the only way to stop one was a
 * hand-authored `filter` on each arm. So a workflow that plainly read "if paid →
 * charge, else → email" charged AND emailed.
 *
 * The invariant that makes shipping this safe: an UNLABELED graph must behave
 * exactly as it did. Every workflow authored before labels existed has unlabeled
 * edges, and pruning one of them would silently delete half a running system.
 */
import { describe, expect, it } from 'vitest';
import { outletTaken, prunedByEdgeLabel } from './cloudExecutor';
import { compileCanvasWorkflowSteps } from '../../domain/canvasWorkflowSpec';
import { compileDefinition, yamlToDefinition } from '../../domain/workflowGraph';

const dep = (id: string, output: string, status = 'completed') => ({ id, status, output });

describe('outletTaken', () => {
  it('reads the branch tag both ways', () => {
    expect(outletTaken(JSON.stringify({ $branch: true }))).toBe('true');
    expect(outletTaken(JSON.stringify({ $branch: false }))).toBe('false');
  });

  it('reads a router route by name', () => {
    expect(outletTaken(JSON.stringify({ $route: 'refund' }))).toBe('refund');
  });

  it('returns null for a node that published no outlet', () => {
    // A plain step somebody drew a labeled edge out of. Inventing an outlet here
    // would prune a path for a node that never forked.
    expect(outletTaken('plain text')).toBeNull();
    expect(outletTaken(JSON.stringify({ ok: true }))).toBeNull();
    expect(outletTaken('')).toBeNull();
  });

  it('prefers $route over $branch when a payload somehow carries both', () => {
    expect(outletTaken(JSON.stringify({ $route: 'a', $branch: false }))).toBe('a');
  });
});

describe('prunedByEdgeLabel', () => {
  it('prunes an arm whose branch went the other way', () => {
    expect(prunedByEdgeLabel({ d1: 'false' }, [dep('d1', JSON.stringify({ $branch: true }))])).toBe(true);
  });

  it('runs the arm the branch actually took', () => {
    expect(prunedByEdgeLabel({ d1: 'true' }, [dep('d1', JSON.stringify({ $branch: true }))])).toBe(false);
  });

  it('never prunes an unlabeled dependency', () => {
    // THE compatibility invariant. Every edge authored before labels existed is
    // unlabeled, and pruning one would delete half of every running workflow.
    expect(prunedByEdgeLabel(undefined, [dep('d1', JSON.stringify({ $branch: false }))])).toBe(false);
    expect(prunedByEdgeLabel({}, [dep('d1', JSON.stringify({ $branch: false }))])).toBe(false);
  });

  it('does not prune on a labeled edge out of a node that published no outlet', () => {
    // The label is wrong, not the graph. Deleting a path because somebody
    // labelled an edge leaving a plain step is the worse of the two failures.
    expect(prunedByEdgeLabel({ d1: 'true' }, [dep('d1', 'just some text')])).toBe(false);
  });

  it('ignores a dependency that has not completed', () => {
    // `dispositionFromDeps` holds the task at `wait` until then; deciding an
    // outlet from a running node's empty output would prune it every time.
    expect(prunedByEdgeLabel({ d1: 'true' }, [dep('d1', '', 'running')])).toBe(false);
  });

  it('prunes when ANY labeled dependency disagrees', () => {
    expect(prunedByEdgeLabel(
      { d1: 'true', d2: 'refund' },
      [dep('d1', JSON.stringify({ $branch: true })), dep('d2', JSON.stringify({ $route: 'charge' }))],
    )).toBe(true);
  });
});

describe('the graph carries labels end to end', () => {
  it('compiles an edge label onto the dependent step', () => {
    const compiled = compileDefinition({
      nodes: [
        { id: 'b', kind: 'branch', label: 'Paid?', position: { x: 0, y: 0 }, config: { condition: 'paid' } },
        { id: 'y', kind: 'output', label: 'Charge', position: { x: 1, y: 0 }, config: {} },
        { id: 'n', kind: 'output', label: 'Email', position: { x: 1, y: 1 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'b', target: 'y', label: 'true' },
        { id: 'e2', source: 'b', target: 'n', label: 'false' },
      ],
    });
    expect(compiled.find((s) => s.nodeId === 'y')?.edgeLabels).toEqual({ b: 'true' });
    expect(compiled.find((s) => s.nodeId === 'n')?.edgeLabels).toEqual({ b: 'false' });
  });

  it('leaves `edgeLabels` off entirely for an unlabeled graph', () => {
    const compiled = compileDefinition({
      nodes: [
        { id: 'a', kind: 'trigger', label: 'Start', position: { x: 0, y: 0 }, config: {} },
        { id: 'b', kind: 'output', label: 'Out', position: { x: 1, y: 0 }, config: {} },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
    });
    expect(compiled.find((s) => s.nodeId === 'b')).not.toHaveProperty('edgeLabels');
  });

  it('survives a hand-authored YAML round trip', () => {
    const def = yamlToDefinition([
      'nodes:',
      '  - id: b',
      '    kind: branch',
      '  - id: y',
      '    kind: output',
      'edges:',
      '  - source: b',
      '    target: y',
      '    label: "true"',
    ].join('\n'));
    expect(def.edges[0]?.label).toBe('true');
  });
});

describe('a canvas list after a branch is the TAKEN path', () => {
  it('labels the edge leaving an explicit branch step', () => {
    const { definition } = compileCanvasWorkflowSteps([
      { title: 'Only if paid', kind: 'branch', condition: 'order.paid' },
      { title: 'Charge the card', connector: 'stripe', action: 'charge' },
    ]);
    expect(definition.edges.find((e) => e.source === 's1')?.label).toBe('true');
  });

  it('leaves a bare condition as a filter, which already prunes on its own', () => {
    // `inferKind` resolves a bare `condition` to `filter`, and a filter whose
    // predicate fails drops its payload and cancels its whole downstream cone.
    // Labelling that edge would add a second, redundant gate on the same test.
    const { definition } = compileCanvasWorkflowSteps([
      { title: 'Only if paid', condition: 'order.paid' },
      { title: 'Charge the card', connector: 'stripe', action: 'charge' },
    ]);
    expect(definition.nodes.find((n) => n.id === 's1')?.kind).toBe('filter');
    expect(definition.edges.find((e) => e.source === 's1')?.label).toBeUndefined();
  });

  it('leaves every other edge unconditional', () => {
    // Labelling an ordinary edge would hand the executor an outlet to prune on
    // for a node that publishes none.
    const { definition } = compileCanvasWorkflowSteps([
      { title: 'Send the SMS', connector: 'twilio', action: 'send_sms' },
      { title: 'Post to Slack', connector: 'slack', action: 'post_message' },
    ]);
    expect(definition.edges.every((e) => e.label === undefined)).toBe(true);
  });
});
