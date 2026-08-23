import { describe, expect, it } from 'vitest';
import { compileBoardFlow, type BoardFlowConnection, type BoardFlowObject } from './compileBoardFlow';

function step(id: string, data: Record<string, unknown>, x = 0): BoardFlowObject {
  return { id, position: { x, y: 0 }, data: { kind: 'flowStep', title: id, ...data } };
}

function link(source: string, target: string, sourceHandle?: string): BoardFlowConnection {
  return { id: `${source}->${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) };
}

describe('compileBoardFlow', () => {
  it('compiles the steps that are on the board and ignores everything else', () => {
    const result = compileBoardFlow(
      [
        step('a', { stepKind: 'llm', stepConfig: { prompt: 'Summarize {{input}}' } }),
        { id: 'ds', position: { x: 0, y: 0 }, data: { kind: 'dataset', title: 'Rows' } },
      ],
      [link('ds', 'a')],
    );
    expect(result.issues).toEqual([]);
    expect(result.definition.nodes.map((node) => node.kind)).toEqual(['trigger', 'llm']);
    // The dataset connection says where the data came from, not when to run.
    expect(result.definition.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual(['trigger->a']);
  });

  it('says so when there is nothing to compile', () => {
    expect(compileBoardFlow([], []).issues[0]?.messageKey).toBe('noSteps');
  });

  it('refuses a step that describes an intention but no call', () => {
    const result = compileBoardFlow([step('a', { stepKind: 'llm', stepConfig: {} })], []);
    expect(result.issues[0]).toMatchObject({ objectId: 'a', messageKey: 'llmNeedsPrompt' });
    expect(result.definition.nodes).toEqual([]);
    expect(result.compiledCount).toBe(0);
  });

  it('names the missing half of an integration call', () => {
    const missingConnector = compileBoardFlow([step('a', { stepKind: 'connector', stepConfig: {} })], []);
    expect(missingConnector.issues[0]?.messageKey).toBe('connectorNeedsConnector');
    const missingAction = compileBoardFlow([step('a', { stepKind: 'connector', stepConfig: { connector: 'twilio' } })], []);
    expect(missingAction.issues[0]).toMatchObject({ messageKey: 'connectorNeedsAction', values: { connector: 'twilio' } });
  });

  it('carries the OUTLET an edge was drawn from onto the edge as its label', () => {
    const result = compileBoardFlow(
      [
        step('sw', { stepKind: 'switch', stepConfig: { field: 'status', cases: '[{"match":"ready","name":"Ready"}]', fallback: 'Else' } }),
        step('a', { stepKind: 'agent', stepConfig: { task: 'ship it' } }, 300),
        step('b', { stepKind: 'agent', stepConfig: { task: 'chase it' } }, 300),
      ],
      [link('sw', 'a', 'outlet:0'), link('sw', 'b', 'outlet:else')],
    );
    const labels = Object.fromEntries(result.definition.edges.filter((edge) => edge.label).map((edge) => [edge.target, edge.label]));
    expect(labels).toEqual({ a: 'Ready', b: 'Else' });
  });

  it('leaves an ordinary connection unlabeled, so nothing is pruned by it', () => {
    const result = compileBoardFlow(
      [step('a', { stepKind: 'agent', stepConfig: { task: 'one' } }), step('b', { stepKind: 'agent', stepConfig: { task: 'two' } }, 300)],
      [link('a', 'b')],
    );
    expect(result.definition.edges.find((edge) => edge.source === 'a')?.label).toBeUndefined();
  });

  it('lowers DATA IN into a mapping step in front, built from json spans', () => {
    const result = compileBoardFlow(
      [
        step('a', { stepKind: 'agent', stepConfig: { task: 'one' } }),
        step('b', { stepKind: 'agent', stepConfig: { task: 'two' }, stepInputs: [{ key: 'who', from: 'customer.email' }] }, 300),
      ],
      [link('a', 'b')],
    );
    const map = result.definition.nodes.find((node) => node.id === 'b:in');
    expect(map?.kind).toBe('transform');
    expect(map?.config.expression).toBe('{"who": {{ json customer.email }}}');
    // The upstream edge now ENTERS the mapping step, not the step itself.
    expect(result.definition.edges.some((edge) => edge.source === 'a' && edge.target === 'b:in')).toBe(true);
    expect(result.definition.edges.some((edge) => edge.source === 'b:in' && edge.target === 'b')).toBe(true);
  });

  it('lowers DATA OUT into a variable capture after the step', () => {
    const result = compileBoardFlow(
      [
        step('a', { stepKind: 'agent', stepConfig: { task: 'one' }, stepOutputs: [{ key: 'orderId', from: 'order.id' }] }),
        step('b', { stepKind: 'agent', stepConfig: { task: 'two' } }, 300),
      ],
      [link('a', 'b')],
    );
    const capture = result.definition.nodes.find((node) => node.id === 'a:out');
    expect(capture?.kind).toBe('set-variables');
    expect(JSON.parse(String(capture?.config.values))).toEqual({ orderId: '{{ order.id }}' });
    // The downstream edge now LEAVES the capture, so the variable is written first.
    expect(result.definition.edges.some((edge) => edge.source === 'a:out' && edge.target === 'b')).toBe(true);
  });

  it('never funnels a multi-outlet step through a capture, which would collapse its fan-out', () => {
    const result = compileBoardFlow(
      [step('sw', { stepKind: 'switch', stepConfig: { cases: '[]' }, stepOutputs: [{ key: 'x', from: '' }] })],
      [],
    );
    expect(result.definition.nodes.some((node) => node.id === 'sw:out')).toBe(false);
  });

  it('synthesizes ONE manual trigger in front of every root', () => {
    const result = compileBoardFlow(
      [step('a', { stepKind: 'agent', stepConfig: { task: 'one' } }), step('b', { stepKind: 'agent', stepConfig: { task: 'two' } }, 300)],
      [],
    );
    expect(result.definition.nodes.filter((node) => node.kind === 'trigger')).toHaveLength(1);
    expect(result.definition.edges.map((edge) => edge.target).sort()).toEqual(['a', 'b']);
  });

  it('keeps an authored trigger instead of adding a second start', () => {
    const result = compileBoardFlow(
      [step('t', { stepKind: 'trigger', stepConfig: { triggerType: 'schedule', cron: '0 9 * * *' } }), step('a', { stepKind: 'agent', stepConfig: { task: 'one' } }, 300)],
      [link('t', 'a')],
    );
    expect(result.definition.nodes.filter((node) => node.kind === 'trigger')).toHaveLength(1);
    expect(result.definition.nodes[0]?.config.cron).toBe('0 9 * * *');
  });
});
