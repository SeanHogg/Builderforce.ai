/**
 * Coverage for the Flow Control / Tools / Text Parser / Diagnostics / AI Agents
 * node kinds added for Make.com parity (see cloudExecutor.ts's `executeCloudNode`
 * switch). Mirrors cloudExecutor.test.ts's style: no DB, so only the
 * usageCtx-free kinds (pure expression/text evaluation) are exercised end-to-end
 * here; the usageCtx-gated kinds (set-variable/get-variable/increment) are
 * checked only for their "needs a tenant context" refusal, same as
 * gmail/connector/mcp. `web-search` needs neither DB nor usageCtx to RUN (it
 * degrades to the keyless floor), so it is only exercised for its
 * no-usageCtx-required validation path here; its real vendor call is covered by
 * cloudExecutor.test.ts's stubbed-outbound-port test and by
 * webSearchCredential.test.ts's backing-resolution coverage — not re-mocked here.
 */

import { describe, expect, it } from 'vitest';
import { executeCloudNode, dispositionFromDeps, type CloudExecutorEnv } from './cloudExecutor';

const env = {} as CloudExecutorEnv;

describe('router', () => {
  it('tags $route with the first matching route', async () => {
    const config = {
      routes: [
        { name: 'Then', condition: 'status == "ready"' },
        { name: 'Else', condition: '' },
      ],
    };
    const result = await executeCloudNode(env, { kind: 'router', config }, JSON.stringify({ status: 'ready' }));
    expect(JSON.parse(result.output)).toMatchObject({ status: 'ready', $route: 'Then' });
  });

  it('falls back when no route matches', async () => {
    const config = { routes: [{ name: 'Then', condition: 'status == "ready"' }], fallback: 'Nope' };
    const result = await executeCloudNode(env, { kind: 'router', config }, JSON.stringify({ status: 'pending' }));
    expect(JSON.parse(result.output)).toMatchObject({ status: 'pending', $route: 'Nope' });
  });

  it('passes non-object payloads through unchanged', async () => {
    const result = await executeCloudNode(env, { kind: 'router', config: { routes: [] } }, 'plain text');
    expect(result.output).toBe('plain text');
  });

  it('parses routes from a JSON string (the real config-panel shape, not a live array)', async () => {
    const config = { routes: '[{"name":"Then","condition":"status == \\"ready\\""}]', fallback: 'Else' };
    const result = await executeCloudNode(env, { kind: 'router', config }, JSON.stringify({ status: 'ready' }));
    expect(JSON.parse(result.output)).toMatchObject({ $route: 'Then' });
  });

  it('degrades to the fallback on malformed routes JSON rather than throwing', async () => {
    const result = await executeCloudNode(env, { kind: 'router', config: { routes: 'not json', fallback: 'Else' } }, JSON.stringify({ x: 1 }));
    expect(JSON.parse(result.output)).toMatchObject({ $route: 'Else' });
  });
});

describe('switch', () => {
  it('tags $route with the case matching a named field', async () => {
    const config = { field: 'status', cases: [{ match: 'ready', name: 'Ready' }, { match: 'pending', name: 'Pending' }] };
    const result = await executeCloudNode(env, { kind: 'switch', config }, JSON.stringify({ status: 'ready' }));
    expect(JSON.parse(result.output)).toMatchObject({ status: 'ready', $route: 'Ready' });
  });

  it('falls back when no case matches', async () => {
    const config = { field: 'status', cases: [{ match: 'ready', name: 'Ready' }], fallback: 'Nope' };
    const result = await executeCloudNode(env, { kind: 'switch', config }, JSON.stringify({ status: 'other' }));
    expect(JSON.parse(result.output)).toMatchObject({ $route: 'Nope' });
  });

  it('matches against the whole (trimmed) input text when no field is set', async () => {
    const payload = JSON.stringify({ a: 1 });
    const config = { cases: `[{"match":${JSON.stringify(payload)},"name":"Match"}]` };
    const result = await executeCloudNode(env, { kind: 'switch', config }, payload);
    expect(JSON.parse(result.output)).toMatchObject({ $route: 'Match' });
  });
});

describe('numeric-aggregator', () => {
  it('sums numeric dependency outputs, dropping non-numeric ones', async () => {
    const result = await executeCloudNode(env, { kind: 'numeric-aggregator', config: { op: 'sum' }, depOutputs: ['1', '2', 'not-a-number', '3'] }, '');
    expect(result.output).toBe('6');
  });

  it('supports avg/min/max/count', async () => {
    const depOutputs = ['2', '4', '6'];
    expect((await executeCloudNode(env, { kind: 'numeric-aggregator', config: { op: 'avg' }, depOutputs }, '')).output).toBe('4');
    expect((await executeCloudNode(env, { kind: 'numeric-aggregator', config: { op: 'min' }, depOutputs }, '')).output).toBe('2');
    expect((await executeCloudNode(env, { kind: 'numeric-aggregator', config: { op: 'max' }, depOutputs }, '')).output).toBe('6');
    expect((await executeCloudNode(env, { kind: 'numeric-aggregator', config: { op: 'count' }, depOutputs }, '')).output).toBe('3');
  });
});

describe('table-aggregator', () => {
  it('keeps only dependency outputs that parsed as an object', async () => {
    const result = await executeCloudNode(env, { kind: 'table-aggregator', config: {}, depOutputs: ['{"a":1}', 'not json', '"a string"', '{"b":2}'] }, '');
    expect(JSON.parse(result.output)).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('text-aggregator', () => {
  it('joins dependency outputs with the configured separator', async () => {
    const result = await executeCloudNode(env, { kind: 'text-aggregator', config: { separator: ', ' }, depOutputs: ['a', 'b', 'c'] }, '');
    expect(result.output).toBe('a, b, c');
  });
});

describe('merge', () => {
  it('array strategy JSON-parses each dependency output', async () => {
    const result = await executeCloudNode(
      env,
      { kind: 'merge', config: { strategy: 'array' }, depOutputs: ['{"a":1}', '"two"', 'three'] },
      '',
    );
    expect(JSON.parse(result.output)).toEqual([{ a: 1 }, 'two', 'three']);
  });

  it('object-keys strategy zips dependency outputs to named keys', async () => {
    const result = await executeCloudNode(
      env,
      { kind: 'merge', config: { strategy: 'object-keys', keys: 'left,right' }, depOutputs: ['1', '2'] },
      '',
    );
    expect(JSON.parse(result.output)).toEqual({ left: 1, right: 2 });
  });

  it('first strategy returns only the first dependency output', async () => {
    const result = await executeCloudNode(env, { kind: 'merge', config: { strategy: 'first' }, depOutputs: ['a', 'b'] }, '');
    expect(result.output).toBe('a');
  });
});

describe('assert', () => {
  it('passes through the payload, tagged, when the expression holds', async () => {
    const result = await executeCloudNode(env, { kind: 'assert', config: { expression: 'x == 1' } }, JSON.stringify({ x: 1 }));
    expect(JSON.parse(result.output)).toMatchObject({ x: 1, $assert: true });
  });

  it('throws (fails the task) when the expression fails and onFail=fail-task', async () => {
    await expect(executeCloudNode(env, { kind: 'assert', config: { expression: 'x == 1', onFail: 'fail-task' } }, JSON.stringify({ x: 2 })))
      .rejects.toThrow(/Assertion failed/);
  });

  it('does not throw when onFail=warn-only', async () => {
    const result = await executeCloudNode(env, { kind: 'assert', config: { expression: 'x == 1', onFail: 'warn-only' } }, JSON.stringify({ x: 2 }));
    expect(JSON.parse(result.output)).toMatchObject({ $assert: false });
  });
});

describe('regex-match / html-to-text nodes', () => {
  it('regex-match wraps workflowTextTools.regexMatch', async () => {
    const result = await executeCloudNode(env, { kind: 'regex-match', config: { pattern: '\\d+', flags: 'g' } }, 'a1 b22');
    expect(JSON.parse(result.output)).toMatchObject({ matched: true, matches: ['1', '22'] });
  });

  it('html-to-text strips tags', async () => {
    const result = await executeCloudNode(env, { kind: 'html-to-text', config: {} }, '<b>hi</b>');
    expect(result.output).toBe('hi');
  });
});

describe('usageCtx-gated Tools kinds refuse without a tenant context', () => {
  it('set-variable', async () => {
    await expect(executeCloudNode(env, { kind: 'set-variable', config: { key: 'k' } }, 'v')).rejects.toThrow(/tenant context/);
  });
  it('get-variable', async () => {
    await expect(executeCloudNode(env, { kind: 'get-variable', config: { key: 'k' } }, '')).rejects.toThrow(/tenant context/);
  });
  it('increment', async () => {
    await expect(executeCloudNode(env, { kind: 'increment', config: { key: 'k' } }, '')).rejects.toThrow(/tenant context/);
  });
  it('set-variables', async () => {
    await expect(executeCloudNode(env, { kind: 'set-variables', config: { values: '{"k":"v"}' } }, '')).rejects.toThrow(/tenant context/);
  });
  it('get-variables', async () => {
    await expect(executeCloudNode(env, { kind: 'get-variables', config: { keys: 'k' } }, '')).rejects.toThrow(/tenant context/);
  });
});

describe('compose-string', () => {
  it('renders the {{input}} template', async () => {
    const result = await executeCloudNode(env, { kind: 'compose-string', config: { template: 'Hello {{input}}!' } }, 'world');
    expect(result.output).toBe('Hello world!');
  });

  it('defaults to {{input}} when no template is set', async () => {
    const result = await executeCloudNode(env, { kind: 'compose-string', config: {} }, 'raw');
    expect(result.output).toBe('raw');
  });
});

describe('convert-encoding', () => {
  it('base64-encodes the input', async () => {
    const result = await executeCloudNode(env, { kind: 'convert-encoding', config: { mode: 'base64-encode' } }, 'hello');
    expect(result.output).toBe(Buffer.from('hello').toString('base64'));
  });

  it('url-decodes the input', async () => {
    const result = await executeCloudNode(env, { kind: 'convert-encoding', config: { mode: 'url-decode' } }, 'a%20b');
    expect(result.output).toBe('a b');
  });
});

describe('Text Parser additions wire the pure helpers', () => {
  it('html-table', async () => {
    const html = '<table><tr><td>a</td><td>b</td></tr></table>';
    const result = await executeCloudNode(env, { kind: 'html-table', config: {} }, html);
    expect(JSON.parse(result.output)).toEqual([['a', 'b']]);
  });

  it('html-elements', async () => {
    const result = await executeCloudNode(env, { kind: 'html-elements', config: { tag: 'a' } }, '<a href="/x">hi</a>');
    expect(JSON.parse(result.output)).toEqual([{ text: 'hi', attrs: { href: '/x' } }]);
  });

  it('match-elements', async () => {
    const html = '<li>keep</li><li>drop</li>';
    const result = await executeCloudNode(env, { kind: 'match-elements', config: { tag: 'li', pattern: '^keep$' } }, html);
    expect(JSON.parse(result.output)).toEqual([{ text: 'keep', attrs: {} }]);
  });

  it('match-pattern-advanced', async () => {
    const result = await executeCloudNode(env, { kind: 'match-pattern-advanced', config: { pattern: '(?<n>\\d+)' } }, 'x1 y22');
    expect(JSON.parse(result.output)).toEqual([
      { match: '1', groups: { n: '1' }, index: 1 },
      { match: '22', groups: { n: '22' }, index: 4 },
    ]);
  });

  it('replace', async () => {
    const result = await executeCloudNode(env, { kind: 'replace', config: { pattern: '-', replacement: '_', literal: true } }, 'a-b-c');
    expect(result.output).toBe('a_b_c');
  });

  it('chunk-text', async () => {
    const result = await executeCloudNode(env, { kind: 'chunk-text', config: { chunkSize: 4, overlap: 0 } }, 'abcdefgh');
    expect(JSON.parse(result.output)).toEqual(['abcd', 'efgh']);
  });
});

describe('healthcheck', () => {
  it('refuses a blocked (internal) host rather than fetching it', async () => {
    const result = await executeCloudNode(env, { kind: 'healthcheck', config: { url: 'http://169.254.169.254/latest/meta-data', expectedStatus: 200 } }, '');
    const parsed = JSON.parse(result.output);
    expect(parsed.up).toBe(false);
    expect(parsed.error).toBeTruthy();
  });

  it('requires a URL', async () => {
    await expect(executeCloudNode(env, { kind: 'healthcheck', config: {} }, '')).rejects.toThrow(/URL/);
  });
});

describe('web-search', () => {
  it('requires a query (no {{input}} and no upstream text to fall back to)', async () => {
    await expect(executeCloudNode(env, { kind: 'web-search', config: {} }, ''))
      .rejects.toThrow(/query/);
  });
});

describe('dispositionFromDeps is unaffected by the new kinds', () => {
  it('still resolves run/wait/fail/cancel exactly as before', () => {
    expect(dispositionFromDeps([])).toBe('run');
    expect(dispositionFromDeps(['completed', 'completed'])).toBe('run');
    expect(dispositionFromDeps(['completed', 'pending'])).toBe('wait');
    expect(dispositionFromDeps(['completed', 'failed'])).toBe('fail');
    expect(dispositionFromDeps(['completed', 'cancelled'])).toBe('cancel');
  });
});
