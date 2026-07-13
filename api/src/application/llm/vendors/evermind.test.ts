import { describe, expect, it } from 'vitest';
import { evermindModule } from './evermind';
import { buildEvermindFixtureStore as fixtureStore } from '../__fixtures__/evermindModel';

describe('evermind vendor module', () => {
  it('is registered as a no-key, non-auto-routed vendor', () => {
    expect(evermindModule.id).toBe('evermind');
    expect(evermindModule.autoRoute).toBe(false);
    expect(evermindModule.apiKeyFrom({} as never)).toBe('local'); // sentinel — passes the key gate
    expect(evermindModule.tierFor('anything')).toBe('STANDARD');
  });

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
