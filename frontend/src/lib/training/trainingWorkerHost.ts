/**
 * The training worker's message handler, separate from the `self` binding in
 * {@link ./training.worker} so tests can drive it in-process.
 *
 * The worker owns the engine backend: it requests its OWN WebGPU device (a
 * `GPUDevice` never crosses the worker boundary) and falls back to the engine's
 * CPU reference backend. The backend — and with it the device — is destroyed
 * when a run completes, fails or is cancelled, and before `closed` is sent.
 */

import { cpu, type Backend } from '@webdit/torch/autograd';
import { trainLoRAOnEngine } from './loraEngineTrainer';
import {
  transferablesOf,
  type EngineTrainingRequest,
  type TrainingDevice,
  type TrainingWorkerRequest,
  type TrainingWorkerResponse,
} from './protocol';

export interface EngineSession {
  backend: Backend;
  device: TrainingDevice;
  detail: string;
  destroy(): void;
}

export type EngineSessionFactory = () => Promise<EngineSession>;

function cpuSession(detail: string): EngineSession {
  return { backend: cpu, device: 'cpu', detail, destroy: () => undefined };
}

/** A WebGPU device of the worker's own when the context has one, else the CPU reference. */
export async function acquireEngineSession(): Promise<EngineSession> {
  const nav = (globalThis as { navigator?: { gpu?: unknown } }).navigator;
  if (!nav?.gpu) return cpuSession('no WebGPU in this context');
  try {
    const { createWebGPUBackend } = await import('@webdit/torch/webgpu');
    const backend = await createWebGPUBackend({ powerPreference: 'high-performance' });
    return { backend, device: 'webgpu', detail: backend.adapterDescription, destroy: () => backend.destroy() };
  } catch (error) {
    return cpuSession(error instanceof Error ? error.message : String(error));
  }
}

export type PostResponse = (message: TrainingWorkerResponse, transfer: Transferable[]) => void;

export function createTrainingWorkerHost(post: PostResponse, acquire: EngineSessionFactory = acquireEngineSession) {
  let session: EngineSession | null = null;
  let running = false;
  let cancelled = false;
  const send = (message: TrainingWorkerResponse) => post(message, transferablesOf(message));
  const release = () => {
    session?.destroy();
    session = null;
  };

  async function train(request: EngineTrainingRequest): Promise<void> {
    if (!session) throw new Error('Trainer not initialised. Send { type: "init" } first.');
    running = true;
    cancelled = false;
    try {
      const artifact = await trainLoRAOnEngine(session.backend, request, {
        log: (message) => send({ type: 'log', message }),
        progress: (progress) => send({ type: 'progress', progress }),
        epoch: (step) => send({ type: 'epoch', step }),
        isCancelled: () => cancelled,
      });
      release();
      send(artifact ? { type: 'artifact', artifact } : { type: 'cancelled' });
    } finally {
      running = false;
      release();
    }
  }

  return async function handle(message: TrainingWorkerRequest): Promise<void> {
    try {
      switch (message.type) {
        case 'init':
          release();
          session = await acquire();
          send({ type: 'ready', device: session.device, detail: session.detail });
          return;
        case 'train':
          await train(message.request);
          return;
        case 'cancel':
          cancelled = true;
          if (!running) {
            release();
            send({ type: 'closed' });
          }
          return;
      }
    } catch (error) {
      release();
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
}
