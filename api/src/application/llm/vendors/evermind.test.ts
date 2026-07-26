import { describe, expect, it } from 'vitest';
import { evermindModule } from './evermind';
import { modelSupportsTools } from './registry';
import { VendorFatalError } from './types';
import { buildEvermindFixtureStore as fixtureStore } from '../__fixtures__/evermindModel';

describe('evermind vendor module', () => {
  it('is registered as a no-key, non-auto-routed vendor', () => {
    expect(evermindModule.id).toBe('evermind');
    expect(evermindModule.autoRoute).toBe(false);
    expect(evermindModule.apiKeyFrom({} as never)).toBe('local'); // sentinel — passes the key gate
    expect(evermindModule.tierFor('anything')).toBe('STANDARD');
  });

  it('declares that it cannot tool-call, and `modelSupportsTools` reports it', () => {
    expect(evermindModule.supportsTools).toBe(false);
    expect(modelSupportsTools('evermind/evermind/project/1/11/v7')).toBe(false);
    // Every other vendor is tool-capable unless it opts out — the default must not flip.
    expect(modelSupportsTools('claude-opus-4-8')).toBe(true);
    expect(modelSupportsTools('xai-oauth/grok-4.3')).toBe(true);
  });

  it('REFUSES a tool-bearing request instead of answering in tool-less prose', async () => {
    const ref = 'evermind-models/9/vendor-fixture';
    // A 400 fatal is what advances the cascade to a tool-capable model. Silently
    // ignoring `tools` is the bug: the agent then narrates calls it can never emit.
    const err = await evermindModule.call({
      apiKey: 'local',
      model: ref,
      messages: [{ role: 'user', content: 'list the backlog' }],
      tools: [{ type: 'function', function: { name: 'builtin_chats_list_tickets', parameters: {} } }],
      uploads: fixtureStore(ref),
    }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(VendorFatalError);
    expect((err as VendorFatalError).status).toBe(400);
    expect((err as VendorFatalError).message).toMatch(/no tool-calling/i);
  });

  it('still serves a request with an EMPTY tools array (nothing was actually offered)', async () => {
    const ref = 'evermind-models/9/vendor-fixture';
    const result = await evermindModule.call({
      apiKey: 'local',
      model: ref,
      messages: [{ role: 'user', content: 'alpha beta gamma' }],
      tools: [],
      maxTokens: 6,
      temperature: 0,
      uploads: fixtureStore(ref),
    });
    expect(typeof result.content).toBe('string');
  }, 20000);

  it('generates from a published .evermind via the threaded R2 store', async () => {
    const ref = 'evermind-models/9/vendor-fixture';
    const result = await evermindModule.call({
      apiKey: 'local',
      model: ref, // dispatch strips the `evermind/` prefix → the R2 ref
      messages: [{ role: 'user', content: 'alpha beta gamma' }],
      maxTokens: 6,
      temperature: 0,
      uploads: fixtureStore(ref),
    });
    const raw = result.raw as { object: string; choices: Array<{ message: { content: string } }> };
    expect(raw.object).toBe('chat.completion');
    expect(typeof result.content).toBe('string');
    expect(result.usage?.total_tokens).toBeGreaterThan(0);
  }, 20000);

  it('fails fatally (no failover) when the R2 store is not bound', async () => {
    await expect(
      evermindModule.call({ apiKey: 'local', model: 'evermind-models/9/x', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/not bound/);
  });
});
