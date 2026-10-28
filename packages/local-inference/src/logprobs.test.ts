import { describe, expect, it, vi } from 'vitest';
import { createLogprobPort, labelLogprobsRequest, readLabelLogprobs, type LogprobEngine } from './logprobs';

const body = (alts: Array<[string, number]>) => ({
  choices: [{ logprobs: { content: [{ token: alts[0]?.[0] ?? '', logprob: alts[0]?.[1] ?? 0, top_logprobs: alts.map(([token, logprob]) => ({ token, logprob })) }] } }],
});

const engine = (runtime: LogprobEngine['runtime'], warm: boolean, answer: unknown): LogprobEngine & { complete: ReturnType<typeof vi.fn> } => ({
  runtime,
  warm: () => warm,
  maxTopLogprobs: 20,
  complete: vi.fn(async () => answer),
});

describe('label logprobs', () => {
  it('asks for one token with the label codes and reads them back per label', () => {
    const req = labelLogprobsRequest('Request: find dupes', ['dup.check', 'needs-llm'], 5);
    expect(req).toMatchObject({ max_tokens: 1, logprobs: true, top_logprobs: 2, stream: false });
    expect(JSON.stringify(req.messages)).toContain('A = dup.check');
    expect(readLabelLogprobs(body([[' A', -0.2], ['B', -1.8], ['Z', -4]]), ['dup.check', 'needs-llm'])).toEqual({ 'dup.check': -0.2, 'needs-llm': -1.8 });
    expect(readLabelLogprobs({ choices: [{}] }, ['dup.check'])).toEqual({});
  });

  it('is warm only when an engine has a model resident, and never calls a cold one', async () => {
    const cold = engine('ollama', false, body([['A', -0.1]]));
    const port = createLogprobPort([cold]);
    expect(port.warm()).toBe(false);
    expect(await port.logprobs('p', ['x', 'needs-llm'])).toEqual({});
    expect(cold.complete).not.toHaveBeenCalled();
  });

  it('tries engines in rank order and moves past one that returns no logprobs', async () => {
    const ollama = engine('ollama', true, body([['B', -0.3]]));
    const webllm = engine('webllm', true, { choices: [{ message: { content: 'A' } }] });
    const port = createLogprobPort([ollama, webllm]);
    expect(await port.logprobs('p', ['x', 'needs-llm'])).toEqual({ 'needs-llm': -0.3 });
    expect(webllm.complete).toHaveBeenCalledBefore(ollama.complete);
  });
});
