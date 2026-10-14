/**
 * THE condense primitive (moved from meetings to `llm/condense.ts`): one plan-aware
 * proxy call carrying the caller's shape plus the grounding refusal, and every
 * consumer — meeting minutes, the sell motion, Insights summaries — reads it from
 * here. The meeting-minutes test pins that `summarizeMeeting` still goes through it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  tenantProxyForPlan: vi.fn(),
}));

vi.mock('./tenantProxy', () => ({ tenantProxyForPlan: mocks.tenantProxyForPlan }));

import { condenseTranscript } from './condense';

function proxyResult(content: string | null) {
  const body = content === null ? {} : { choices: [{ message: { role: 'assistant', content } }] };
  return { response: new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }) };
}

beforeEach(() => {
  mocks.complete.mockReset();
  mocks.tenantProxyForPlan.mockReset();
  mocks.tenantProxyForPlan.mockResolvedValue({ proxy: { complete: mocks.complete } });
});

describe('condenseTranscript', () => {
  it('routes through the tenant plan proxy with the shape and the grounding rule', async () => {
    mocks.complete.mockResolvedValueOnce(proxyResult('  Minutes.  '));
    const out = await condenseTranscript({} as never, 7, { transcript: 'A: hi', header: 'Meeting: x', shape: 'Write minutes.', maxTokens: 300 });
    expect(out).toEqual({ text: 'Minutes.' });
    expect(mocks.tenantProxyForPlan).toHaveBeenCalledWith({}, 7, { codingOnly: true });
    const body = mocks.complete.mock.calls[0]![0] as { messages: Array<{ role: string; content: string }>; max_tokens: number; temperature: number };
    expect(body.messages[0]!.content).toContain('Write minutes.');
    expect(body.messages[0]!.content).toContain('Only use what is in the transcript');
    expect(body.messages[1]!.content).toBe('Meeting: x\n\nTranscript:\nA: hi');
    expect(body).toMatchObject({ max_tokens: 300, temperature: 0.3 });
  });

  it('refuses an empty transcript without a model call, and never fabricates on an empty answer', async () => {
    expect(await condenseTranscript({} as never, 7, { transcript: '  ', header: 'h', shape: 's' })).toEqual({ error: 'No transcript to summarize yet.' });
    expect(mocks.complete).not.toHaveBeenCalled();
    mocks.complete.mockResolvedValueOnce(proxyResult(''));
    expect(await condenseTranscript({} as never, 7, { transcript: 't', header: 'h', shape: 's' })).toEqual({ error: 'The model produced nothing to record.' });
  });
});
