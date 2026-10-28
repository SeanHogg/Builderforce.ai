/**
 * The ONE place the review worker is constructed by URL.
 *
 * `new Worker(new URL(…, import.meta.url))` is the form webpack, Turbopack and Vite
 * recognise and emit as a worker chunk. Webpack emits that chunk's LOADER statically,
 * whatever runtime guard surrounds the call, so any server bundle that reached it carried
 * a browser chunk loader (`document.baseURI`) into the shared edge runtime and `next build`
 * died collecting page data with `ReferenceError: document is not defined`. Keeping the
 * expression in this module alone lets a server build swap it for `workerFactory.stub.ts`
 * (frontend `next.config.js`) while the browser bundles keep the real worker.
 */
export function createReviewWorker(): Worker {
  return new Worker(new URL('./knowledgeReview.worker.ts', import.meta.url), { type: 'module', name: 'knowledge-review' });
}
