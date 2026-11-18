/**
 * Browser LoRA training Web Worker — pure transport. The engine, its GPU
 * device and the whole fine-tune live here, off the interaction thread
 * (PRD 22 §3.2). The handler is {@link ./trainingWorkerHost}; the client is
 * {@link ./browserLoRATrainer}.
 */

/// <reference lib="webworker" />

import { createTrainingWorkerHost } from './trainingWorkerHost';
import type { TrainingWorkerRequest } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const handle = createTrainingWorkerHost((message, transfer) => self.postMessage(message, transfer));

self.onmessage = (event: MessageEvent<TrainingWorkerRequest>) => {
  void handle(event.data);
};
