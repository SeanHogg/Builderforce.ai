/**
 * The web app's `bfi` Web Worker: Synapse's engine (the vendored `@seanhogg/bfi-web`)
 * on WebGPU or, without it, on the CPU — off the page's main thread. Started by
 * `browserPageEngines()` (`localFirst.ts`); everything it does is brain-embedded's
 * `runBfiWorker`.
 */
import { runBfiWorker } from '@seanhogg/builderforce-brain-embedded/bfi';

runBfiWorker();
