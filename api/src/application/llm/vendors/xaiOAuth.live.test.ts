/**
 * LIVE: Grok tool calling through OUR adapter — skipped unless `XAI_LIVE_KEY` is set.
 *
 * Stage 2 of the isolation ladder for "Grok won't call tools":
 *   1. `scripts/xai-tool-call-smoke.mjs` — the raw xAI API, no gateway code at all.
 *   2. THIS — the same request through `xaiOAuthModule.callStream` (request builder,
 *      reasoning replay, SSE translator), at 2, 5 and 67 advertised tools.
 *   3. A real chat, read through the "Per model:" raw-response line.
 * Whichever stage first loses the structured call is where the defect lives.
 *
 *   XAI_LIVE_KEY=xai-… npx vitest run src/application/llm/vendors/xaiOAuth.live.test.ts
 *
 * `XAI_LIVE_KEY` is an xAI API key or a SuperGrok OAuth access token; `XAI_LIVE_MODEL`
 * overrides `grok-4.6`.
 */
import { describe, expect, it } from 'vitest';
import { xaiOAuthModule } from './xaiOAuth';
import { UPSTREAM_EVIDENCE_FIELD, type UpstreamTurnEvidence } from './responsesApi';
import type { VendorCallParams } from './types';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const KEY = env['XAI_LIVE_KEY'];
const MODEL = env['XAI_LIVE_MODEL'] ?? 'grok-4.6';

const CORE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search the repository for source code matching a query.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Text or code to search for' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the repository.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Repository-relative path' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
];

/** The two real tools plus unrelated fillers, to measure selection under a large catalog. */
function toolsOfCount(count: number): unknown[] {
  const fillers = Array.from({ length: Math.max(0, count - CORE_TOOLS.length) }, (_, i) => ({
    type: 'function',
    function: {
      name: `workspace_util_${i}`,
      description: `Unrelated workspace utility #${i}: manages billing, calendars and notifications. Never needed to read or search code.`,
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    },
  }));
  return [...CORE_TOOLS, ...fillers];
}

interface TurnOutcome {
  calls: string[];
  text: string;
  evidence: UpstreamTurnEvidence | undefined;
}

async function oneTurn(tools: unknown[]): Promise<TurnOutcome> {
  const { response } = await xaiOAuthModule.callStream!({
    apiKey: KEY!,
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are a coding agent. Use the tools to inspect the repository.' },
      { role: 'user', content: 'Find the RoomRoster component in the repository.' },
    ],
    tools,
    toolChoice: 'auto',
    timeoutMs: 90_000,
  } as unknown as VendorCallParams);
  const frames = (await response.text()).split('\n')
    .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, any>);
  return {
    calls: frames.flatMap((f) => f.choices?.[0]?.delta?.tool_calls ?? []).map((tc: any) => tc.function?.name).filter(Boolean),
    text: frames.map((f) => f.choices?.[0]?.delta?.content ?? '').join(''),
    evidence: frames.map((f) => f[UPSTREAM_EVIDENCE_FIELD] as UpstreamTurnEvidence | undefined).find(Boolean),
  };
}

describe.skipIf(!KEY)(`xai-oauth live tool calling (${MODEL})`, () => {
  for (const count of [2, 5, 67]) {
    it(`returns a structured call that survives translation with ${count} tools advertised`, async () => {
      const outcome = await oneTurn(toolsOfCount(count));
      // Printed so a failure says WHICH side lost the call, not just that one was lost.
      console.log(`[${count} tools] upstream=${JSON.stringify(outcome.evidence)} calls=${JSON.stringify(outcome.calls)} text=${JSON.stringify(outcome.text.slice(0, 200))}`);
      expect(outcome.evidence, 'the translator must report what xAI returned').toBeDefined();
      expect(outcome.evidence!.functionCalls, 'xAI itself returned no structured function_call').toBeGreaterThan(0);
      expect(outcome.calls.length, 'xAI returned a call the translator did not emit').toBe(outcome.evidence!.functionCalls);
      expect(outcome.calls).toContain('search_code');
    }, 120_000);
  }
});
