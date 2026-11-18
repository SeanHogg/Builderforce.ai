/**
 * The browser LoRA artifact: a PEFT-compatible safetensors adapter (through the
 * ONE shared codec, `tensorsToSafetensors` in the memory engine) plus the
 * merged Evermind runtime package the publish route loads.
 */

import {
  BPETokenizer,
  EvermindLM,
  EvermindLMLoRA,
  EvermindModelPackage,
  tokenizerJson,
  tensorsToSafetensors,
} from '@seanhogg/builderforce-memory-engine';
import type { BrowserLoRAArtifact, TrainingParams } from './protocol';

/** The module the browser adapter targets — the tied token embedding. */
export const LORA_TARGET_MODULE = 'embed_tokens';

function safeModelName(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Convert a real LoRA adapter to the PEFT-compatible safetensors container. */
export function exportLoRASafetensors(
  lora: EvermindLMLoRA,
  modelId: string,
  targetModule = LORA_TARGET_MODULE,
  fp16 = true,
): Uint8Array {
  const { adapter } = lora;
  return tensorsToSafetensors([
    {
      name: `base_model.model.${targetModule}.lora_A.weight`,
      shape: [adapter.rank, adapter.cols],
      data: adapter.A,
    },
    {
      name: `base_model.model.${targetModule}.lora_B.weight`,
      shape: [adapter.rows, adapter.rank],
      data: adapter.B,
    },
  ], {
    fp16,
    metadata: {
      format: 'pt',
      peft_type: 'LORA',
      base_model_name_or_path: modelId,
      target_modules: targetModule,
      rank: String(adapter.rank),
      alpha: String(adapter.alpha),
      builderforce_format: 'evermind-lora-v1',
    },
  });
}

export interface ArtifactInputs {
  lora: EvermindLMLoRA;
  model: EvermindLM;
  tokenizer: BPETokenizer;
  modelId: string;
  params: TrainingParams;
  sequenceCount: number;
}

/** Package a trained adapter. `lora.adapter` must hold the final A/B values. */
export function packageBrowserLoRAArtifact({ lora, model, tokenizer, modelId, params, sequenceCount }: ArtifactInputs): BrowserLoRAArtifact {
  const bytes = exportLoRASafetensors(lora, modelId, LORA_TARGET_MODULE, params.precision === 'float16');
  const footprint = lora.footprint();
  const filename = `${safeModelName(modelId)}-adapter.safetensors`;
  const mergedModel = new EvermindLM(model.config);
  mergedModel.loadWeights(lora.merge({ fp16: false }));
  const evermindPackage = EvermindModelPackage.fromLM(mergedModel, {
    name: modelId,
    version: `1.0.${Date.now()}`,
    fp16: params.precision === 'float16',
    createdAt: new Date().toISOString(),
    card: {
      description: `Browser-trained LoRA merge for ${modelId}`,
      trainingSummary: `${sequenceCount} sequences, ${params.epochs} epochs, rank ${params.loraConfig.rank}`,
      tags: ['builderforce', 'browser-lora', 'evermind'],
    },
  }).toBlob();
  const portableTokenizer = tokenizerJson(tokenizer) as { model?: { vocab?: Record<string, number>; merges?: string[] } };
  if (!portableTokenizer.model?.vocab || !portableTokenizer.model.merges) throw new Error('Could not package the trained tokenizer.');
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    filename,
    format: 'safetensors',
    evermindPackage,
    tokenizer: { vocab: portableTokenizer.model.vocab, merges: portableTokenizer.model.merges },
    ...footprint,
  };
}
