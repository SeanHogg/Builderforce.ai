/**
 * The chat webview's `bfi` Web Worker: Synapse's engine (the vendored `@seanhogg/bfi-web`)
 * on WebGPU, off the chat UI's thread — so a wasm trap costs a worker, never the panel's
 * engine for the rest of the session. Started by `pageEngines.ts`; everything it does is
 * brain-embedded's `runBfiWorker`, told in `bfi.init` to serve WebGPU only and to read
 * models through the page (the extension host's file cache).
 */
import { runBfiWorker } from '@seanhogg/builderforce-brain-embedded/bfi';

runBfiWorker();
