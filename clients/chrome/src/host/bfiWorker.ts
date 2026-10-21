/**
 * Rovr's `bfi` Web Worker (`BFI_WORKER_FILE`, an entry of `build.mjs`): Synapse's engine
 * on WebGPU or, without it, on the CPU — off the side panel's thread. The panel starts
 * it (`panelServices.ts`); everything it does is brain-embedded's `runBfiWorker`.
 */
import { runBfiWorker } from '@seanhogg/builderforce-brain-embedded/bfi';

runBfiWorker();
