import { it } from 'vitest';
import { pumpReplica } from './replicaPump.js';
import { buildPack } from './replicaPack.js';
import { fakeServer, world, ROOT } from './replicaTestkit.test-util.js';

it('timing', async () => {
    const w = world();
    let t = Date.now();
    await w.review(0, 300);
    console.log('review', Date.now() - t); t = Date.now();
    const srv = fakeServer();
    const touched = (await w.queue.snapshot()).keys;
    await buildPack({ rootId: ROOT, local: w.local, sources: w.sources, client: srv.client, touched, baseGeneration: 0 });
    console.log('build', Date.now() - t); t = Date.now();
    await pumpReplica({ queue: w.queue, local: w.local, client: srv.client, signal: new AbortController().signal, rootId: ROOT, sources: async () => w.sources, projectId: 1 });
    console.log('pump', Date.now() - t); t = Date.now();
    await w.review(0, 300, 0);
    console.log('rereview', Date.now() - t);
}, 120000);
