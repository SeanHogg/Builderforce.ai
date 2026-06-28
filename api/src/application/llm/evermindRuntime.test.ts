import { describe, expect, it } from 'vitest';
import {
  evermindGenerate,
  buildEvermindCompletion,
  messagesToPrompt,
  loadEvermindModel,
  type ArtifactStore,
} from './evermindRuntime';
import { buildEvermindFixtureStore as buildFixture } from './__fixtures__/evermindModel';

describe('messagesToPrompt', () => {
  it('flattens role-tagged turns and primes the assistant', () => {
    const p = messagesToPrompt([{ role: 'system', content: 'be terse' }, { role: 'user', content: 'hi' }]);
    expect(p).toContain('system: be terse');
    expect(p).toContain('user: hi');
    expect(p.endsWith('assistant:')).toBe(true);
  });
});

describe('evermindGenerate (real .evermind from a mock R2)', () => {
  it('loads the artifact + tokenizer and returns text with token usage', async () => {
    const ref = 'evermind-models/1/fixture-gen';
    const store = buildFixture(ref);
    const gen = await evermindGenerate(store, ref, [{ role: 'user', content: 'alpha beta' }], { maxTokens: 6, temperature: 0 });
    expect(typeof gen.content).toBe('string');
    expect(gen.usage.prompt_tokens).toBeGreaterThan(0);
    expect(gen.usage.total_tokens).toBe(gen.usage.prompt_tokens + gen.usage.completion_tokens);
  }, 20000);

  it('caches the loaded model per ref (no re-fetch on the second call)', async () => {
    const ref = 'evermind-models/1/fixture-cache';
    const store = buildFixture(ref);
    await loadEvermindModel(store, ref);
    const afterFirst = store.calls.length; // model + tokenizer = 2
    await loadEvermindModel(store, ref);
    expect(store.calls.length).toBe(afterFirst); // served from the per-isolate cache
    expect(afterFirst).toBe(2);
  }, 20000);

  it('throws a clear error when the artifact is missing', async () => {
    const store: ArtifactStore = { async get() { return null; } };
    await expect(evermindGenerate(store, 'evermind-models/1/missing', [{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/not found/);
  });
});

describe('buildEvermindCompletion', () => {
  it('produces an OpenAI-compatible chat completion', () => {
    const out = buildEvermindCompletion(
      { content: 'hello', usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } },
      'evermind/evermind-models/1/x',
      1_700_000_000_000,
    );
    expect(out.object).toBe('chat.completion');
    expect((out.choices as Array<{ message: { content: string } }>)[0]!.message.content).toBe('hello');
    expect((out.choices as Array<{ finish_reason: string }>)[0]!.finish_reason).toBe('stop');
    expect(out.model).toBe('evermind/evermind-models/1/x');
  });
});
