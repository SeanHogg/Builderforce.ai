import { describe, expect, it } from 'vitest';
import {
  evermindGenerate,
  evermindGenerateMedia,
  benchmarkEvermind,
  exportEvermindArtifact,
  buildEvermindCompletion,
  messagesToPrompt,
  loadEvermindModel,
  type ArtifactStore,
} from './evermindRuntime';
import {
  buildEvermindFixtureStore as buildFixture,
  buildEvermindMediaFixtureStore as buildMediaFixture,
} from './__fixtures__/evermindModel';

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

describe('evermindGenerateMedia (video/image from a self-contained media artifact)', () => {
  it('loads a media .evermind, generates, and returns shaped base64 frames', async () => {
    const ref = 'evermind-models/1/fixture-media';
    const store = buildMediaFixture(ref, 'video');
    const media = await evermindGenerateMedia(store, ref, { maxFrames: 3, seed: 1 });
    expect(media.modality).toBe('video');
    expect(media.width).toBe(8);
    expect(media.height).toBe(8);
    expect(media.channels).toBe(3);
    expect(Array.isArray(media.frames)).toBe(true);
    expect(media.frameCount).toBe(media.frames.length);
    for (const f of media.frames) expect(typeof f).toBe('string');
    // Tokens were actually generated (the plumbing ran end to end).
    expect(media.usage.completion_tokens).toBeGreaterThan(0);
  }, 20000);

  it('serves the artifact from the per-isolate cache on the second call', async () => {
    const ref = 'evermind-models/1/fixture-media-cache';
    const store = buildMediaFixture(ref, 'video');
    await evermindGenerateMedia(store, ref, { maxFrames: 1, seed: 1 });
    const afterFirst = store.calls.length;
    await evermindGenerateMedia(store, ref, { maxFrames: 1, seed: 1 });
    expect(store.calls.length).toBe(afterFirst); // no re-fetch
  }, 20000);

  it('the TEXT loader rejects a media artifact with a clear steer to the media endpoint', async () => {
    const ref = 'evermind-models/1/fixture-media-text';
    const store = buildMediaFixture(ref, 'video');
    await expect(evermindGenerate(store, ref, [{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/media generation endpoint/);
  }, 20000);
});

describe('benchmarkEvermind (scores the real published artifact)', () => {
  it('returns a scorecard with metrics, vocab size, and a sample — tokenized by the model tokenizer', async () => {
    const ref = 'evermind-models/1/fixture-bench';
    const store = buildFixture(ref);
    const corpus = 'alpha beta gamma. alpha beta delta. gamma beta alpha.';
    const r = await benchmarkEvermind(store, ref, corpus, { topK: 3 });
    expect(r.tokens).toBeGreaterThan(0);
    expect(Number.isFinite(r.perplexity)).toBe(true);
    expect(r.perplexity).toBeGreaterThan(0);
    expect(r.top1Accuracy).toBeGreaterThanOrEqual(0);
    expect(r.top1Accuracy).toBeLessThanOrEqual(1);
    expect(r.topK).toBe(3);
    expect(r.vocabSize).toBeGreaterThan(0);
    expect(typeof r.sample).toBe('string');
  }, 20000);

  it('throws a clear error when the artifact is missing', async () => {
    const store: ArtifactStore = { async get() { return null; } };
    await expect(benchmarkEvermind(store, 'evermind-models/1/missing', 'alpha beta gamma delta epsilon'))
      .rejects.toThrow(/not found/);
  });
});

describe('exportEvermindArtifact (portable export of the published model)', () => {
  it('exports a single-file format (onnx) with bytes + content type', async () => {
    const ref = 'evermind-models/1/fixture-export-onnx';
    const store = buildFixture(ref);
    const r = await exportEvermindArtifact(store, ref, 'onnx');
    expect(r.format).toBe('onnx');
    expect(r.files.length).toBe(1);
    expect(r.files[0]!.path).toMatch(/\.onnx$/);
    expect((r.files[0]!.data as Uint8Array).length ?? (r.files[0]!.data as string).length).toBeGreaterThan(0);
    expect(r.paramCount).toBeGreaterThan(0);
  }, 20000);

  it('exports the huggingface bundle as multiple files incl. a tokenizer.json', async () => {
    const ref = 'evermind-models/1/fixture-export-hf';
    const store = buildFixture(ref);
    const r = await exportEvermindArtifact(store, ref, 'huggingface', { name: 'My Model' });
    expect(r.format).toBe('huggingface');
    expect(r.files.length).toBeGreaterThan(1);
    expect(r.files.some((f) => f.path.endsWith('tokenizer.json'))).toBe(true);
    expect(r.files.some((f) => f.path.endsWith('.safetensors'))).toBe(true);
  }, 20000);

  it('throws a clear error when the artifact is missing', async () => {
    const store: ArtifactStore = { async get() { return null; } };
    await expect(exportEvermindArtifact(store, 'evermind-models/1/missing', 'safetensors'))
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
