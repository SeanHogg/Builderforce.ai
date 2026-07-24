/**
 * Mamba inference/training Web Worker (host side).
 *
 * A WebGPU `GPUDevice` cannot be transferred across the worker boundary, so the
 * worker owns the whole engine: it constructs a {@link MambaModelProvider}, runs
 * init/train/generate/stream/export entirely off the main thread, and streams
 * results back as messages. This keeps the CPU-heavy parts of decoding (sampling
 * over a 150k-vocab logit vector per token, BPE) from janking the UI — the
 * article's "run inference in a Web Worker" best practice.
 *
 * The client lives in {@link ./mamba-worker-client}. Reusing MambaModelProvider
 * here means there is ONE implementation of the engine wiring; the worker is pure
 * transport.
 */

/// <reference lib="webworker" />

import { MambaModelProvider } from './model-provider';
import type { WorkerRequest, WorkerResponse } from './mamba-worker-protocol';

declare const self: DedicatedWorkerGlobalScope;

let provider: MambaModelProvider | null = null;

function reply(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length) self.postMessage(msg, transfer);
  else self.postMessage(msg);
}

function ensure(): MambaModelProvider {
  if (!provider) throw new Error('Worker provider not initialised — send { type: "init" } first');
  return provider;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const { id } = req;
  try {
    switch (req.type) {
      case 'init': {
        provider = new MambaModelProvider(req.config);
        await provider.init();
        reply({
          id,
          type: 'result',
          value: { ready: provider.isReady(), failureReason: provider.failureReason() },
        });
        break;
      }
      case 'generate': {
        const value = await ensure().generate(req.input, req.context);
        reply({ id, type: 'result', value });
        break;
      }
      case 'stream': {
        const value = await ensure().stream(req.input, req.context, (token) =>
          reply({ id, type: 'token', token }),
        );
        reply({ id, type: 'result', value });
        break;
      }
      case 'train': {
        const value = await ensure().train(req.corpus, {
          ...req.options,
          onEpochEnd: (epoch, loss) => reply({ id, type: 'epoch', epoch, loss }),
        });
        reply({ id, type: 'result', value });
        break;
      }
      case 'export': {
        const buffer = await ensure().exportTrainedWeights(req.opts);
        // Transfer (not copy) the checkpoint back to the main thread.
        reply({ id, type: 'result', value: buffer }, [buffer]);
        break;
      }
      case 'dispose': {
        provider?.dispose();
        provider = null;
        reply({ id, type: 'result', value: null });
        break;
      }
    }
  } catch (err) {
    reply({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
