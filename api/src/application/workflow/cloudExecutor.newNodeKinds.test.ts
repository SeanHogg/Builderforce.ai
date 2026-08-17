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
