import { describe, expect, it } from 'vitest';
import { subflowInterface } from './subflowInterface';
import type { BoardFlowConnection, BoardFlowObject } from './boardFlow';

function step(id: string, data: Record<string, unknown>): BoardFlowObject {
  return { id, position: { x: 0, y: 0 }, data: { kind: 'flowStep', title: id, ...data } };
}

function link(source: string, target: string): BoardFlowConnection {
  return { id: `${source}->${target}`, source, target };
}

describe('subflowInterface', () => {
  it('reads parameters off the steps nothing feeds', () => {
    const shape = subflowInterface({
      objects: [
        step('revoke', { stepKind: 'llm', stepInputs: [{ key: 'employee', from: 'person' }] }),
        step('notify', { stepKind: 'llm', stepInputs: [{ key: 'manager', from: 'boss' }] }),
      ],
      connections: [link('revoke', 'notify')],
    });
    // `manager` is fed by the step in front of it — it is plumbing, not a parameter.
    expect(shape.inputs.map((port) => port.key)).toEqual(['employee']);
    expect(shape.acceptsRawInput).toBe(false);
    expect(shape.stepCount).toBe(2);
  });

  it('says when a canvas takes whatever it is handed', () => {
    const shape = subflowInterface({
      objects: [step('work', { stepKind: 'llm' })],
      connections: [],
    });
    expect(shape.inputs).toEqual([]);
    expect(shape.acceptsRawInput).toBe(true);
  });

  it('returns only what nothing inside the board consumes', () => {
    const shape = subflowInterface({
      objects: [
        step('payroll', { stepKind: 'llm', stepOutputs: [{ key: 'settlement', from: 'total' }, { key: 'draft', from: 'body' }] }),
        step('letter', { stepKind: 'llm', stepInputs: [{ key: 'text', from: 'draft.body' }] }),
      ],
      connections: [link('payroll', 'letter')],
    });
    // `draft` is read downstream (`draft.body` — the first path segment counts), so
    // it is internal. `settlement` is the only thing this canvas publishes.
    expect(shape.outputs.map((port) => port.key)).toEqual(['settlement']);
  });

  it('does not mistake a similarly named variable for a consumer', () => {
    const shape = subflowInterface({
      objects: [
        step('a', { stepKind: 'llm', stepOutputs: [{ key: 'settlement', from: 'total' }] }),
        step('b', { stepKind: 'llm', stepInputs: [{ key: 'x', from: 'settlement_note' }] }),
      ],
      connections: [link('a', 'b')],
    });
    expect(shape.outputs.map((port) => port.key)).toEqual(['settlement']);
  });

  it('ignores the furniture a flow is drawn beside', () => {
    const shape = subflowInterface({
      objects: [
        { id: 'ds', position: { x: 0, y: 0 }, data: { kind: 'dataset', title: 'Rows' } },
        step('work', { stepKind: 'llm', stepInputs: [{ key: 'employee', from: '' }] }),
      ],
      // A step wired to the dataset it reads is still an entry step: the connection
      // says where the data came from, not that something ran before it.
      connections: [link('ds', 'work')],
    });
    expect(shape.stepCount).toBe(1);
    expect(shape.inputs.map((port) => port.key)).toEqual(['employee']);
  });

  it('has nothing to say about an empty canvas', () => {
    expect(subflowInterface({ objects: [], connections: [] })).toEqual({
      inputs: [], outputs: [], acceptsRawInput: false, stepCount: 0,
    });
  });
});
