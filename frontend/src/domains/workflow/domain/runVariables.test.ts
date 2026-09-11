import { describe, expect, it } from 'vitest';
import { publishedRunVariables, runVariablePath, upstreamRunVariables } from './runVariables';

const step = (id: string, data: Record<string, unknown>) => ({ id, data: { kind: 'flowStep', title: id, ...data } });

describe('publishedRunVariables', () => {
  it('reads declared DATA OUT, Set Variable and Set Variables', () => {
    expect(publishedRunVariables({ kind: 'flowStep', stepKind: 'agent', stepOutputs: [{ key: 'orderId', from: 'order.id' }] })).toEqual(['orderId']);
    expect(publishedRunVariables({ kind: 'flowStep', stepKind: 'set-variable', stepConfig: { key: ' total ' } })).toEqual(['total']);
    expect(publishedRunVariables({ kind: 'flowStep', stepKind: 'set-variables', stepConfig: { values: '{"a":"1","b":"{{input}}"}' } })).toEqual(['a', 'b']);
  });

  it('ignores objects that are not steps and malformed value maps', () => {
    expect(publishedRunVariables({ kind: 'note', stepOutputs: [{ key: 'x', from: '' }] })).toEqual([]);
    expect(publishedRunVariables({ kind: 'flowStep', stepKind: 'set-variables', stepConfig: { values: '{oops' } })).toEqual([]);
  });
});

describe('upstreamRunVariables', () => {
  const objects = [
    step('a', { stepKind: 'agent', stepOutputs: [{ key: 'orderId', from: 'order.id' }] }),
    step('b', { stepKind: 'set-variable', stepConfig: { key: 'tier' } }),
    step('c', { stepKind: 'agent' }),
    step('d', { stepKind: 'agent', stepOutputs: [{ key: 'later', from: '' }] }),
    step('e', { stepKind: 'set-variable', stepConfig: { key: 'unrelated' } }),
  ];
  // a → b → c → d, and e off to the side.
  const connections = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
  ];

  it('offers every variable published upstream, transitively and sorted', () => {
    expect(upstreamRunVariables('c', objects, connections)).toEqual(['orderId', 'tier']);
  });

  it('never offers a variable a later or unconnected step publishes', () => {
    expect(upstreamRunVariables('b', objects, connections)).toEqual(['orderId']);
    expect(upstreamRunVariables('a', objects, connections)).toEqual([]);
  });

  it('terminates on a cycle, and never offers a step its own outputs', () => {
    // `a` sits upstream of itself through d → a, but `orderId` is what `a` itself
    // publishes — reading it back into its own input would be read-before-write.
    expect(upstreamRunVariables('a', objects, [...connections, { source: 'd', target: 'a' }])).toEqual(['later', 'tier']);
  });

  it('builds the $vars path the executor resolves', () => {
    expect(runVariablePath('orderId')).toBe('$vars.orderId');
  });
});
