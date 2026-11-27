import { describe, expect, it } from 'vitest';
import { createMemoryKeyValue } from './keyValue';
import { createSettings } from './settings';

describe('the `bfi serve` address setting', () => {
  it('reads the current key', async () => {
    const storage = createMemoryKeyValue({ 'settings.bfiServeUrl': 'http://127.0.0.1:11500' });
    expect(await createSettings(storage).synapseUrl()).toBe('http://127.0.0.1:11500');
  });

  it('migrates the retired `settings.synapseUrl` key on first read: copied to the new key, old one removed', async () => {
    const storage = createMemoryKeyValue({ 'settings.synapseUrl': 'http://127.0.0.1:11435' });
    const settings = createSettings(storage);
    expect(await settings.synapseUrl()).toBe('http://127.0.0.1:11435');
    expect(await storage.get('settings.bfiServeUrl')).toBe('http://127.0.0.1:11435');
    expect(await storage.get('settings.synapseUrl')).toBeUndefined();
    expect(await settings.synapseUrl()).toBe('http://127.0.0.1:11435');
  });

  it('prefers the new key over a stale old one', async () => {
    const storage = createMemoryKeyValue({ 'settings.bfiServeUrl': 'http://new', 'settings.synapseUrl': 'http://old' });
    expect(await createSettings(storage).synapseUrl()).toBe('http://new');
  });

  it('is null when neither key is set', async () => {
    expect(await createSettings(createMemoryKeyValue()).synapseUrl()).toBeNull();
  });

  it('a cleared address stays cleared: it does not come back from the retired key', async () => {
    const storage = createMemoryKeyValue({ 'settings.synapseUrl': 'http://old' });
    const settings = createSettings(storage);
    await settings.setSynapseUrl(null);
    expect(await settings.synapseUrl()).toBeNull();
    expect(await storage.get('settings.synapseUrl')).toBeUndefined();
  });

  it('writes only the new key', async () => {
    const storage = createMemoryKeyValue();
    await createSettings(storage).setSynapseUrl(' http://127.0.0.1:11600 ');
    expect(await storage.get('settings.bfiServeUrl')).toBe('http://127.0.0.1:11600');
    expect(await storage.get('settings.synapseUrl')).toBeUndefined();
  });
});
