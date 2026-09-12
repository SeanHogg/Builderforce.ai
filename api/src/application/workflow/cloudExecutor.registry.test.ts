/**
 * `NODE_HANDLERS` replaced a ~40-case switch. These pin the two properties that
 * refactor must not change: the exact set of kinds the cloud runtime executes,
 * and the unsupported-kind refusal the switch's `default` produced — including for
 * a kind that happens to be an `Object.prototype` key.
 */
import { describe, expect, it } from 'vitest';
import { NODE_HANDLERS, executeCloudNode } from './cloudExecutor';
import type { Env } from '../../env';

const env = {} as Env;

const EXPECTED_KINDS = [
  // control
  'trigger', 'branch', 'router', 'switch', 'iterator', 'subflow', 'sleep', 'output', 'assert',
  // transform
  'transform', 'filter', 'merge', 'numeric-aggregator', 'table-aggregator', 'text-aggregator',
  'compose-string', 'convert-encoding', 'regex-match', 'html-to-text', 'html-table',
  'html-elements', 'match-elements', 'match-pattern-advanced', 'replace', 'chunk-text',
  // ai
  'llm', 'analyze-image', 'extract-document-data', 'transcribe-audio',
  // io
  'web-search', 'web-fetch', 'healthcheck', 'gmail', 'google-drive', 'connector', 'mcp',
  'set-variable', 'get-variable', 'increment', 'get-variables', 'set-variables',
];

describe('NODE_HANDLERS', () => {
  it('registers exactly the kinds the cloud runtime executes', () => {
    expect([...NODE_HANDLERS.keys()].sort()).toEqual([...EXPECTED_KINDS].sort());
  });

  it.each(['memory', 'knowledge', 'train', 'agent', 'unknown', 'constructor', '__proto__', 'toString'])(
    'refuses %s with the self-hosted hint',
    async (kind) => {
      await expect(executeCloudNode(env, { kind, config: {} }, '')).rejects.toThrow(
        `node kind "${kind}" is not supported on the cloud runtime — run this workflow on a self-hosted agentHost`,
      );
    },
  );

  it('a synchronous handler throw still surfaces as a rejection', async () => {
    await expect(executeCloudNode(env, { kind: 'subflow', config: { canvas: 'c1' } }, '')).rejects.toThrow(
      'Nested canvas "c1" was not resolved before the run started, so it cannot run.',
    );
  });
});
