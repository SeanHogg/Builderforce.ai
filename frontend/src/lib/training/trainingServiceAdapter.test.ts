import { describe, expect, it } from 'vitest';
import {
  BPETokenizer,
  EvermindLM,
  EvermindModelPackage,
  exportSafetensors,
  namedTensors,
  safetensorsToTensors,
  tensorsToSafetensors,
  tokenizerJson,
  type HuggingFaceTokenizerSpec,
} from '@seanhogg/builderforce-memory-engine';
import type { TrainingArtifactKey, TrainingArtifactStore } from '@seanhogg/builderforce-webcontainers/app';
import { blueprint, service } from '@/lib/runTarget/blueprintFixtures';
import {
  baseFromCheckpoint,
  loadTrainingServiceArtifact,
  TrainingAdapterError,
  trainingArtifactKey,
  trainingFilesToArtifact,
  trainingServiceIds,
} from './trainingServiceAdapter';

const RANK = 4;
const ALPHA = 8;

function makeBase() {
  const tokenizer = new BPETokenizer();
  tokenizer.train(['hello world from the browser', 'train a small adapter in python'], { numMerges: 32 });
  const model = new EvermindLM({ vocabSize: tokenizer.vocabSize, dModel: 16, numLayers: 1, hiddenDim: 32, seed: 7 });
  return { tokenizer, model };
}

/** Deterministic, non-zero values (a trained B is not zero). */
const filled = (length: number, seed: number) => Float32Array.from({ length }, (_, i) => Math.sin(seed + i) * 0.05);

/**
 * Exactly what a Python training script writes with `peft`'s `save_pretrained` on @webdit/torch
 * (torch/utils/peft_io.py): F32 safetensors with peft's key names and `__metadata__`, plus
 * `adapter_config.json`; optionally the base it trained on beside it.
 */
function pythonSave(rows: number, cols: number, withBase?: { model: EvermindLM; tokenizer: BPETokenizer }) {
  const a = filled(RANK * cols, 1);
  const b = filled(rows * RANK, 2);
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>([
    ['adapter/adapter_model.safetensors', tensorsToSafetensors([
      { name: 'base_model.model.embed_tokens.lora_A.weight', shape: [RANK, cols], data: a },
      { name: 'base_model.model.embed_tokens.lora_B.weight', shape: [rows, RANK], data: b },
    ], { metadata: { format: 'pt', peft_type: 'LORA', producer: '@webdit/torch', rank: String(RANK), alpha: String(ALPHA) } })],
    ['adapter/adapter_config.json', encoder.encode(JSON.stringify({ r: RANK, lora_alpha: ALPHA, target_modules: ['embed_tokens'], peft_type: 'LORA', base_model_name_or_path: 'evermind-tiny' }))],
  ]);
  if (withBase) {
    files.set('adapter/base_model.safetensors', exportSafetensors(withBase.model));
    files.set('adapter/tokenizer.json', encoder.encode(JSON.stringify(tokenizerJson(withBase.tokenizer))));
  }
  return { files, a, b };
}

/** The base model's token embedding ([vocab, dModel]). */
const embeddingOf = (model: EvermindLM) => namedTensors(model).find((t) => t.name.includes('embed'))!;

describe('trainingFilesToArtifact — a Python-trained adapter becomes the browser artifact', () => {
  it('round-trips: the adapter bytes carry the trained A/B and the runnable package loads with them merged', () => {
    const { tokenizer, model } = makeBase();
    const embedding = embeddingOf(model);
    const [rows, cols] = embedding.shape as [number, number];
    const { files, a, b } = pythonSave(rows, cols, { model, tokenizer });

    const artifact = trainingFilesToArtifact(files, 'train');

    // The PEFT adapter the inference path stores: same names, the trained values (fp16-rounded).
    const adapter = safetensorsToTensors(new Uint8Array(artifact.bytes));
    const savedA = adapter.find((t) => t.name.endsWith('lora_A.weight'))!;
    const savedB = adapter.find((t) => t.name.endsWith('lora_B.weight'))!;
    expect(savedA.shape).toEqual([RANK, cols]);
    expect(savedB.shape).toEqual([rows, RANK]);
    savedA.data.forEach((value, i) => expect(value).toBeCloseTo(a[i]!, 3));
    savedB.data.forEach((value, i) => expect(value).toBeCloseTo(b[i]!, 3));
    expect(artifact.filename).toBe('evermind-tiny-adapter.safetensors');
    expect(artifact.trainableParams).toBe(RANK * (rows + cols));

    // The runnable package loads, and its embedding is base + (alpha / r) · B·A.
    const loaded = EvermindModelPackage.fromBlob(artifact.evermindPackage).loadLM();
    expect(loaded.config.vocabSize).toBe(tokenizer.vocabSize);
    const merged = embeddingOf(loaded).data;
    const scale = ALPHA / RANK;
    for (const [r, c] of [[0, 0], [1, 3], [rows - 1, cols - 1]] as const) {
      let delta = 0;
      for (let k = 0; k < RANK; k++) delta += b[r * RANK + k]! * a[k * cols + c]!;
      expect(merged[r * cols + c]!).toBeCloseTo(embedding.data[r * cols + c]! + scale * delta, 2);
    }
    expect(Object.keys(artifact.tokenizer.vocab)).toHaveLength(tokenizer.vocabSize);
  });

  it('uses the chosen base when the save carries none', () => {
    const { tokenizer, model } = makeBase();
    const [rows, cols] = embeddingOf(model).shape as [number, number];
    const { files } = pythonSave(rows, cols);
    const base = baseFromCheckpoint(exportSafetensors(model), tokenizerJson(tokenizer) as HuggingFaceTokenizerSpec, 'panel-base');
    const artifact = trainingFilesToArtifact(files, 'train', () => base);
    expect(EvermindModelPackage.fromBlob(artifact.evermindPackage).loadLM().config.vocabSize).toBe(tokenizer.vocabSize);
    // Named for the adapter's own base model (adapter_config.json), not the panel's id.
    expect(artifact.filename).toBe('evermind-tiny-adapter.safetensors');
  });

  it('never builds the chosen base when the save carries its own', () => {
    const { tokenizer, model } = makeBase();
    const [rows, cols] = embeddingOf(model).shape as [number, number];
    const { files } = pythonSave(rows, cols, { model, tokenizer });
    const artifact = trainingFilesToArtifact(files, 'train', () => { throw new Error('the panel base was built'); });
    expect(artifact.format).toBe('safetensors');
  });

  it('with several saves, takes the shallowest, then the highest-numbered', () => {
    const { tokenizer, model } = makeBase();
    const [rows, cols] = embeddingOf(model).shape as [number, number];
    const { files } = pythonSave(rows, cols, { model, tokenizer });
    const moved = (dir: string) => new Map([...files].map(([path, bytes]) => [path.replace('adapter/', `${dir}/`), bytes]));
    // checkpoint-1000's adapter is the trained one; checkpoint-200's would not fit (wrong rows).
    const stale = pythonSave(rows + 1, cols).files;
    const both = new Map([...moved('checkpoint-1000'), ...[...stale].map(([p, b]) => [p.replace('adapter/', 'checkpoint-200/'), b] as const)]);
    expect(trainingFilesToArtifact(both, 'train').format).toBe('safetensors');
  });

  it.each([
    ['noSave', () => new Map<string, Uint8Array>()],
    ['noAdapter', () => new Map([['notes.txt', new Uint8Array([1])]])],
    ['noBase', () => pythonSave(10, 16).files],
    ['notEmbeddingAdapter', () => new Map([['adapter_model.safetensors', tensorsToSafetensors([{ name: 'base_model.model.q_proj.lora_A.weight', shape: [1, 1], data: new Float32Array(1) }])], ['adapter_config.json', new TextEncoder().encode('{"r":1,"lora_alpha":1}')]])],
  ] as const)('names what is missing: %s', (issue, files) => {
    expect(() => trainingFilesToArtifact(files(), 'train')).toThrow(TrainingAdapterError);
    try { trainingFilesToArtifact(files(), 'train'); } catch (error) { expect((error as TrainingAdapterError).issue).toBe(issue); }
  });

  it('refuses an adapter that does not fit the base embedding', () => {
    const { tokenizer, model } = makeBase();
    const [rows, cols] = embeddingOf(model).shape as [number, number];
    const { files } = pythonSave(rows + 1, cols, { model, tokenizer });
    expect(() => trainingFilesToArtifact(files, 'train')).toThrow(expect.objectContaining({ issue: 'shapeMismatch' }));
  });
});

describe('loadTrainingServiceArtifact — reads the save the runtime kept', () => {
  it('reads the service’s save under the host id, the project and the service id', async () => {
    const { tokenizer, model } = makeBase();
    const [rows, cols] = embeddingOf(model).shape as [number, number];
    const { files } = pythonSave(rows, cols, { model, tokenizer });
    const asked: TrainingArtifactKey[] = [];
    const store: TrainingArtifactStore = {
      replace: async () => undefined,
      remove: async () => undefined,
      list: async (key) => { asked.push(key); return [...files.keys()].sort(); },
      read: async (_key, path) => files.get(path),
    };
    const artifact = await loadTrainingServiceArtifact({ projectId: '7', serviceId: 'train' }, undefined, store);
    expect(asked).toEqual([trainingArtifactKey({ projectId: '7', serviceId: 'train' })]);
    expect(asked[0]).toEqual({ projectId: 'builderforce', specProjectId: '7', serviceId: 'train' });
    expect(artifact.format).toBe('safetensors');
  });
});

describe('trainingServiceIds', () => {
  it('lists the blueprint’s training services by their runtime ids', () => {
    const app = blueprint({ services: [
      service({ id: 'api', kind: 'python', devCommand: 'uvicorn main:app', installCommand: '', ports: [8000] }),
      service({ id: '@acme/train', kind: 'training', devCommand: 'python train.py', installCommand: '', ports: [] }),
    ] });
    expect(trainingServiceIds(app)).toEqual(['train']);
    expect(trainingServiceIds(null)).toEqual([]);
  });
});
