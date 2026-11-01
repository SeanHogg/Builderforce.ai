import { describe, expect, it } from 'vitest';
import { buildModelItems, modelInUse, DEFAULT_MODEL_CHOICE_LABELS as L, type ChatModelOptions } from './modelChoice';
import { servedModelLabel } from './servedModelLabel';

const options: ChatModelOptions = {
  local: [
    { id: 'local/ollama/qwen3:8b', label: 'qwen3:8b', runtime: 'Ollama' },
    { id: 'local/kimi-code/k3', label: 'K3', runtime: 'Kimi Code' },
  ],
  byo: [],
  free: [],
  plan: [],
  paid: [],
};

describe('where a local/ ref runs is the runtime registry\'s word, never the prefix', () => {
  it('files an engine on this device under "On this device" and a hosted runtime under the accounts', () => {
    const items = buildModelItems(options, L);
    expect(items.find((i) => i.key === 'model:local/ollama/qwen3:8b')).toMatchObject({ category: 'local' });
    const kimi = items.find((i) => i.key === 'model:local/kimi-code/k3');
    expect(kimi).toMatchObject({ category: 'byo', detail: 'Billed to your own Kimi Code account — no plan credit used.' });
    expect(kimi?.title).toBe('Sent to Kimi Code with your own account from this machine. The model does not run here.');
  });

  it('never claims a hosted pick runs on this machine in the "model in use" line', () => {
    const items = buildModelItems({ ...options, local: [] }, L);
    expect(modelInUse({ mode: 'model', model: 'local/kimi-code/k3' }, items, L).detail).not.toMatch(/Runs on this machine/);
    expect(modelInUse({ mode: 'model', model: 'local/ollama/qwen3:8b' }, items, L).detail).toMatch(/Runs on this machine via Ollama/);
  });
});

describe('servedModelLabel', () => {
  it('names an on-device model by its last segment and says it runs on the device', () => {
    expect(servedModelLabel('local/ollama/qwen3:8b')).toEqual({ name: 'qwen3:8b', onDevice: true, hostedFromHere: false });
    expect(servedModelLabel('local/ollama/hf.co/user/repo:q4').name).toBe('repo:q4');
  });

  it('a hosted runtime reached from this machine is not on the device', () => {
    expect(servedModelLabel('local/kimi-code/k3')).toEqual({ name: 'k3', onDevice: false, hostedFromHere: true });
  });

  it('leaves every other ref to the caller\'s own display rule', () => {
    expect(servedModelLabel('direct/anthropic/claude')).toEqual({ name: undefined, onDevice: false, hostedFromHere: false });
    expect(servedModelLabel(undefined).name).toBeUndefined();
  });
});
