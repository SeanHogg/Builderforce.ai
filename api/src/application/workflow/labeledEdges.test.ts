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

describe('a labeled arm runs only when the branch took it', () => {
  // The END-TO-END shape the canvas now produces. A section of steps is lowered by
  // `frontend/src/domains/workflow/domain/compileBoardFlow.ts` — the one compiler —
  // and what arrives here is a definition, so that is what these build. (The
  // authored-list lowering that used to be tested through this file lived in a
  // SECOND compiler on the server, `canvasWorkflowSpec.ts`, and is gone; its labeling
  // rule is now covered by `flowStepsFromCanvasSteps.test.ts` beside the compiler
  // that owns it.) What must not regress is what the EXECUTOR does with the labels.
  const branchArms = yamlToDefinition([
    'nodes:',
    '  - id: b',
    '    kind: branch',
    '  - id: charge',
    '    kind: connector',
    '  - id: email',
    '    kind: connector',
    'edges:',
    '  - source: b',
    '    target: charge',
    '    label: "true"',
    '  - source: b',
    '    target: email',
    '    label: "false"',
  ].join('\n'));

  it('runs the arm the branch took and prunes the other', () => {
    const compiled = compileDefinition(branchArms);
    const charge = compiled.find((step) => step.nodeId === 'charge')!;
    const email = compiled.find((step) => step.nodeId === 'email')!;
    const wentTrue = [dep('b', JSON.stringify({ $branch: true }))];
    expect(prunedByEdgeLabel(charge.edgeLabels, wentTrue)).toBe(false);
    expect(prunedByEdgeLabel(email.edgeLabels, wentTrue)).toBe(true);
  });

  it('leaves an UNLABELED graph running both successors, exactly as before', () => {
    // THE compatibility invariant, asserted on a whole graph rather than a single
    // call: a filter's own predicate is what prunes its arm, and a definition that
    // never named an outlet must not acquire one here.
    const compiled = compileDefinition(yamlToDefinition([
      'nodes:',
      '  - id: f',
      '    kind: filter',
      '  - id: sms',
      '    kind: connector',
      '  - id: slack',
      '    kind: connector',
      'edges:',
      '  - source: f',
      '    target: sms',
      '  - source: f',
      '    target: slack',
    ].join('\n')));
    const ran = [dep('f', JSON.stringify({ ok: true }))];
    for (const nodeId of ['sms', 'slack']) {
      const step = compiled.find((candidate) => candidate.nodeId === nodeId)!;
      expect(step).not.toHaveProperty('edgeLabels');
      expect(prunedByEdgeLabel(step.edgeLabels, ran)).toBe(false);
    }
  });
});
