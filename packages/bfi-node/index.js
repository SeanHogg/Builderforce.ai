'use strict';
/**
 * `@seanhogg/bfi-node` — the `BfiEngine` class of `@seanhogg/bfi-web` (Builderforce spec
 * 34 §3.1), running natively in a Node process: wgpu on Vulkan (Metal on macOS), or the
 * CPU on every core. Same contract, so a host's `bfi` page engine takes either module.
 *
 * `loadBfiNode(addonPath?)` returns `{ BfiEngine }`. The addon is the prebuilt
 * `bfi_node.<platform>-<arch>.node`; a host that copies it elsewhere (an extension's
 * `out/`) passes its path.
 */
const path = require('node:path');

/** The prebuilt addon's file name for a platform / arch. */
function addonFileName(platform = process.platform, arch = process.arch) {
  return `bfi_node.${platform}-${arch}.node`;
}

/** `{ BfiEngine }` over the addon at `addonPath` (default: next to this file). */
function loadBfiNode(addonPath) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const native = require(addonPath ?? path.join(__dirname, addonFileName()));
  return { BfiEngine: engineClass(native) };
}

/** An event's failure as the Error a host branches on. `trap` is the native twin of a
 *  wasm trap (the engine panicked and is poisoned): raised as a `RuntimeError`, which is
 *  what a host's trap handling keys on to start a fresh worker. */
function failure(kind, payload) {
  const error = new Error(payload);
  if (kind === 'trap') error.name = 'RuntimeError';
  return error;
}

function engineClass(native) {
  class BfiEngine {
    #engine;
    #backend;

    constructor(engine, backend) {
      this.#engine = engine;
      this.#backend = backend;
    }

    /** `{ backend?: 'webgpu' | 'cpu' | 'auto' }`; `auto` = the GPU when an adapter exists. */
    static create(options) {
      return new Promise((resolve, reject) => {
        let engine;
        try {
          engine = native.createEngine(options?.backend ?? null, (kind, payload) => {
            if (kind === 'ready') resolve(new BfiEngine(engine, payload));
            else reject(failure(kind, payload));
          });
        } catch (e) {
          reject(e);
        }
      });
    }

    /** The capability record (`BfiSupport`): a wgpu adapter probe — never a device. */
    static async support() {
      return JSON.parse(await native.support());
    }

    /** The context `load` will serve for a shape (`BfiContextShape`). */
    static contextFor(shape) {
      return native.contextFor(JSON.stringify(shape ?? {}));
    }

    get backend() {
      return this.#backend;
    }

    /** Load a GGUF the host streams; resolves with `BfiModelInfo`. */
    async load(chunks, totalBytes, onProgress, options) {
      const engine = this.#engine;
      let settle;
      const done = new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
      // Claimed synchronously: a `busy:` (or disposed) engine throws HERE, before the
      // stream is touched — its bytes must never reach the load that is running, and
      // (as in bfi-web) the caller keeps its stream.
      engine.load(totalBytes, JSON.stringify(options ?? {}), (kind, payload) => {
        if (kind === 'progress') {
          const [loaded, total] = JSON.parse(payload);
          try {
            onProgress?.(loaded, total);
          } catch {
            // A progress callback's failure is the host's, never the load's.
          }
        } else if (kind === 'done') settle.resolve(JSON.parse(payload));
        else settle.reject(failure(kind, payload));
      });
      // One chunk in flight: each push settles when the engine takes it. A stream that
      // cannot be read (already locked) fails the claimed load rather than leaving it
      // waiting for a chunk that never comes.
      let reader;
      try {
        reader = chunks.getReader();
      } catch (e) {
        engine.failChunks(String(e?.message ?? e));
        return await done;
      }
      const pump = (async () => {
        try {
          for (;;) {
            const { done: end, value } = await reader.read();
            if (end) break;
            await engine.pushChunk(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
          }
          engine.endChunks();
        } catch (e) {
          engine.failChunks(String(e?.message ?? e));
        } finally {
          reader.releaseLock();
        }
      })();
      // A load that ended early (bad header, unload, trap) stops reading the stream: the
      // engine rejects the push in flight, and cancelling ends the read in flight.
      done.catch(() => reader.cancel().catch(() => {}));
      try {
        return await done;
      } finally {
        await pump;
      }
    }

    /** One `chat.completions` request; `onChunk` gets each chunk JSON, resolves with the
     *  completion JSON, rejects `aborted` on `signal`. */
    chat(requestJson, onChunk, signal) {
      const engine = this.#engine;
      return new Promise((resolve, reject) => {
        let settled = false;
        const onAbort = () => engine.abort();
        const settle = (fn, value) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          fn(value);
        };
        engine.chat(requestJson, (kind, payload) => {
          if (settled) return;
          if (kind === 'chunk') {
            try {
              onChunk(payload);
            } catch (e) {
              engine.abort();
              settle(reject, new Error(`engine_error: onChunk threw: ${e?.message ?? e}`));
            }
          } else if (kind === 'done') settle(resolve, payload);
          else settle(reject, failure(kind, payload));
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) engine.abort();
      });
    }

    /** Drop the model; a running chat ends `aborted`. */
    unload() {
      this.#engine.unload();
    }

    /** Stop the engine thread: a running chat ends `aborted` at its next step, a running
     *  load at its next chunk; the model is freed. */
    dispose() {
      this.#engine.dispose();
    }
  }
  return BfiEngine;
}

module.exports = { loadBfiNode, addonFileName };
