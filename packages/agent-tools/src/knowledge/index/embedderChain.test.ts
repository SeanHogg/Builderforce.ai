import { describe, expect, it, vi } from 'vitest';
import type { WarmEmbedderSource } from './contract.js';
import { EMBEDDER_ORDER, batchEmbedder, idleLoadedEmbedder, resolveWarmEmbedder } from './embedderChain.js';
import { bucketEmbedder, manualIdle } from './testkit.test-util.js';

const source = (id: WarmEmbedderSource['id'], warm: boolean, port = bucketEmbedder(id)): WarmEmbedderSource & { port: ReturnType<typeof vi.fn> } => ({
    id,
    warm: () => warm,
    port: vi.fn(() => port),
});

describe('embedder chain — order', () => {
    it('is Synapse → Evermind → Ollama, whatever order the host offers them in', async () => {
        expect(EMBEDDER_ORDER).toEqual(['synapse', 'evermind', 'ollama']);
        const synapse = bucketEmbedder('synapse');
        const evermind = bucketEmbedder('evermind');
        const ollama = bucketEmbedder('ollama');
        expect(await resolveWarmEmbedder([source('ollama', true, ollama), source('evermind', true, evermind), source('synapse', true, synapse)])).toBe(synapse);
        expect(await resolveWarmEmbedder([source('ollama', true, ollama), source('evermind', true, evermind)])).toBe(evermind);
        expect(await resolveWarmEmbedder([source('ollama', true, ollama), source('evermind', false, evermind)])).toBe(ollama);
    });
});

describe('embedder chain — warm only', () => {
    it('never asks a cold source for its port, and none warm ⇒ no embedder', async () => {
        const cold = source('ollama', false);
        expect(await resolveWarmEmbedder([cold])).toBeUndefined();
        expect(cold.port).not.toHaveBeenCalled();
    });

    it('skips a source that went cold between warm() and port()', async () => {
        const gone: WarmEmbedderSource = { id: 'evermind', warm: () => true, port: () => undefined };
        const ollama = bucketEmbedder('ollama');
        expect(await resolveWarmEmbedder([gone, source('ollama', true, ollama)])).toBe(ollama);
    });

    it('an on-disk model reads cold until an idle pass has loaded it — the request never waits', async () => {
        const sched = manualIdle();
        const port = bucketEmbedder('evermind-cpu');
        const load = vi.fn(async () => port);
        const ev = idleLoadedEmbedder({ id: 'evermind', stamp: () => '/m.evermind@1', load, idle: sched });
        expect(ev.warm()).toBe(false);
        expect(load).not.toHaveBeenCalled();
        expect(sched.pending()).toBe(true);
        expect(ev.warm()).toBe(false);
        expect(sched.pending()).toBe(true);
        await sched.run();
        expect(load).toHaveBeenCalledTimes(1);
        expect(ev.warm()).toBe(true);
        expect(await resolveWarmEmbedder([ev])).toBe(port);
    });

    it('no model on disk ⇒ never warm, nothing scheduled', () => {
        const sched = manualIdle();
        const ev = idleLoadedEmbedder({ id: 'evermind', stamp: () => undefined, load: async () => bucketEmbedder(), idle: sched });
        expect(ev.warm()).toBe(false);
        expect(sched.pending()).toBe(false);
    });

    it('a failed load is not retried until the model on disk changes', async () => {
        const sched = manualIdle();
        let stamp = '/m.evermind@1';
        const load = vi.fn(async (s: string) => (s.endsWith('@1') ? undefined : bucketEmbedder(`evermind:${s}`)));
        const ev = idleLoadedEmbedder({ id: 'evermind', stamp: () => stamp, load, idle: sched });
        ev.warm();
        await sched.run();
        expect(ev.warm()).toBe(false);
        expect(sched.pending()).toBe(false);
        stamp = '/m.evermind@2';
        ev.warm();
        await sched.run();
        expect(ev.warm()).toBe(true);
        expect(load).toHaveBeenCalledTimes(2);
    });
});

describe('embedder chain — fingerprint', () => {
    it('a single-text embedder carries its model and width in the fingerprint', async () => {
        const port = batchEmbedder({ embed: async () => [1, 0, 0] }, 'evermind-cpu:lm@7', 3);
        expect(port.fingerprint).toBe('evermind-cpu:lm@7:3');
        expect(port.dims).toBe(3);
        expect(await port.embed(['a', 'b'])).toHaveLength(2);
        await expect(batchEmbedder({ embed: async () => [1, 0] }, 'x', 3).embed(['a'])).rejects.toThrow(/expected 3/);
    });

    it('a new checkpoint save drops the loaded port — its vectors are another fingerprint', async () => {
        const sched = manualIdle();
        let stamp = '/m.evermind@1';
        const ev = idleLoadedEmbedder({
            id: 'evermind',
            stamp: () => stamp,
            load: async (s) => bucketEmbedder(`evermind-cpu:${s}`),
            idle: sched,
        });
        ev.warm();
        await sched.run();
        expect((await resolveWarmEmbedder([ev]))?.fingerprint).toBe('evermind-cpu:/m.evermind@1');
        stamp = '/m.evermind@2';
        expect(ev.warm()).toBe(false);
        await sched.run();
        expect((await resolveWarmEmbedder([ev]))?.fingerprint).toBe('evermind-cpu:/m.evermind@2');
    });
});
