/**
 * A blueprint `training` service's saved adapter → the {@link BrowserLoRAArtifact} the
 * existing inference path takes (PRD 31 §W9 phase 7): the same artifact the in-browser
 * trainer produces, so the panel publishes it (`publishEvermindModel`) and generation loads
 * it exactly as it does a browser-trained adapter. ONE conversion, no second packager:
 * the weights decode through the memory engine's safetensors codec and package through
 * `loraArtifact.ts`.
 *
 * What a training script saves (`bfwc.training.artifact_dir()`, kept by the runtime in
 * this page's IndexedDB under the host's project id, the Builderforce project and the
 * service id):
 * - `adapter_model.safetensors` + `adapter_config.json` — `peft`'s `save_pretrained`, with
 *   the adapter on the Evermind token embedding (`base_model.model.embed_tokens.lora_A/B.weight`);
 * - optionally the base it trained on: `base_model.safetensors` (an Evermind checkpoint) and
 *   its `tokenizer.json`. Without them the caller supplies the base (the panel's checkpoint
 *   and tokenizer), since the merged runtime package needs the base weights.
 *
 * The constraint this puts on the script: its LoRA must sit on a `nn.Linear(d_model, vocab)`
 * named `embed_tokens` whose weight IS the Evermind base's tied token embedding (@webdit/torch's
 * `peft` wraps only `nn.Linear`), so the merge into the tied embedding is the model it trained.
 * A Python Evermind model + export helper in `@webdit/torch` is the open follow-up (make.md W9).
 */
import {
  BPETokenizer,
  EvermindLMLoRA,
  importEvermind,
  safetensorsToTensors,
  type EvermindLM,
  type HuggingFaceTokenizerSpec,
  type NamedTensor,
} from '@seanhogg/builderforce-memory-engine';
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import type { TrainingArtifactKey, TrainingArtifactStore } from '@seanhogg/builderforce-webcontainers/app';
import { TRAINING_HOST_PROJECT_ID } from '@/lib/browserRuntime/previewPythonOptions';
import { mapBlueprint } from '@/lib/runTarget/blueprintToApplicationSpec';
import { assertPairedBase, LORA_TARGET_MODULE, packageBrowserLoRAArtifact } from './loraArtifact';
import type { BrowserLoRAArtifact, TrainingParams } from './protocol';

export const ADAPTER_WEIGHTS_FILE = 'adapter_model.safetensors';
export const ADAPTER_CONFIG_FILE = 'adapter_config.json';
export const BASE_CHECKPOINT_FILE = 'base_model.safetensors';
export const BASE_TOKENIZER_FILE = 'tokenizer.json';

/** A training service of a Builderforce project's application (its spec `projectId` is the project id). */
export interface TrainingServiceRef {
  projectId: string;
  serviceId: string;
}

/** The base the adapter rides on: the model, its tokenizer, and the id the package is named for. */
export interface TrainingBase {
  model: EvermindLM;
  tokenizer: BPETokenizer;
  modelId: string;
}

/** Why a save could not become an artifact — a stable code the UI localizes. */
export type TrainingAdapterIssue = 'noSave' | 'noAdapter' | 'notEmbeddingAdapter' | 'shapeMismatch' | 'noBase';

export class TrainingAdapterError extends Error {
  constructor(readonly issue: TrainingAdapterIssue, detail: string) {
    super(detail);
    this.name = 'TrainingAdapterError';
  }
}

/** The runtime ids of a blueprint's training services (as the run target maps them). */
export function trainingServiceIds(blueprint: AppBlueprint | null): string[] {
  if (!blueprint) return [];
  return mapBlueprint(blueprint).spec.services.filter((service) => service.type === 'training').map((service) => service.id);
}

/** The runtime's artifact key for `ref` (the same three parts the provider keeps the save under). */
export function trainingArtifactKey(ref: TrainingServiceRef): TrainingArtifactKey {
  return { projectId: TRAINING_HOST_PROJECT_ID, specProjectId: ref.projectId, serviceId: ref.serviceId };
}

/** Every file of the service's committed save, by path relative to the artifact directory. Empty: nothing saved yet. */
export async function readTrainingServiceFiles(ref: TrainingServiceRef, store?: TrainingArtifactStore): Promise<Map<string, Uint8Array>> {
  const artifacts = store ?? (await import('@seanhogg/builderforce-webcontainers/app')).createTrainingArtifactStore();
  const key = trainingArtifactKey(ref);
  const files = new Map<string, Uint8Array>();
  for (const path of await artifacts.list(key)) {
    const bytes = await artifacts.read(key, path);
    if (bytes) files.set(path, bytes);
  }
  return files;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/** The shallowest file named `name` (a `save_pretrained` directory may be nested); its directory holds its siblings. */
function findFile(files: ReadonlyMap<string, Uint8Array>, name: string, dir?: string): [string, Uint8Array] | undefined {
  const matches = [...files].filter(([path]) => baseName(path) === name && (dir === undefined || dirOf(path) === dir));
  // Several saves (`checkpoint-200/`, `checkpoint-1000/`): the shallowest, then the highest-numbered.
  return matches.sort(([a], [b]) => a.split('/').length - b.split('/').length || b.localeCompare(a, 'en', { numeric: true }))[0];
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

interface PeftConfig {
  r?: number;
  lora_alpha?: number;
  base_model_name_or_path?: string;
}

/** A base from an Evermind safetensors checkpoint and its tokenizer (a save's, or the ones chosen in the panel). */
export function baseFromCheckpoint(checkpoint: Uint8Array, tokenizerSpec: HuggingFaceTokenizerSpec, modelId: string): TrainingBase {
  const tokenizer = new BPETokenizer();
  tokenizer.loadHuggingFace(tokenizerSpec);
  const model = importEvermind(checkpoint);
  assertPairedBase(tokenizer, model);
  return { model, tokenizer, modelId };
}

/** The caller's base, built only when the save carries none of its own (it parses a whole checkpoint). */
export type TrainingBaseFallback = () => TrainingBase;

/** The base saved beside the adapter, else the caller's. Named for the adapter's own base model when it says. */
function resolveBase(files: ReadonlyMap<string, Uint8Array>, dir: string, fallback: TrainingBaseFallback | undefined, modelId: string | undefined): TrainingBase {
  const checkpoint = findFile(files, BASE_CHECKPOINT_FILE, dir);
  const tokenizerFile = findFile(files, BASE_TOKENIZER_FILE, dir);
  if (checkpoint && tokenizerFile) {
    const spec = JSON.parse(text(tokenizerFile[1])) as HuggingFaceTokenizerSpec;
    return baseFromCheckpoint(checkpoint[1], spec, modelId ?? 'python-trained');
  }
  if (!fallback) {
    throw new TrainingAdapterError('noBase', `The save has no ${BASE_CHECKPOINT_FILE} + ${BASE_TOKENIZER_FILE}, and no base model was chosen.`);
  }
  const base = fallback();
  return modelId ? { ...base, modelId } : base;
}

function tensorNamed(tensors: readonly NamedTensor[], part: 'lora_A' | 'lora_B'): NamedTensor {
  const name = `base_model.model.${LORA_TARGET_MODULE}.${part}.weight`;
  const found = tensors.find((tensor) => tensor.name === name);
  if (!found) {
    throw new TrainingAdapterError('notEmbeddingAdapter', `${ADAPTER_WEIGHTS_FILE} has no ${name}: the browser path loads adapters on the ${LORA_TARGET_MODULE} module.`);
  }
  return found;
}

const sameShape = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Convert a training service's save into a {@link BrowserLoRAArtifact}. `base` is used when
 * the save carries no base of its own. Throws {@link TrainingAdapterError} naming what is missing.
 */
export function trainingFilesToArtifact(files: ReadonlyMap<string, Uint8Array>, serviceId: string, base?: TrainingBaseFallback): BrowserLoRAArtifact {
  if (files.size === 0) throw new TrainingAdapterError('noSave', `Training service "${serviceId}" has not saved anything yet.`);
  const weights = findFile(files, ADAPTER_WEIGHTS_FILE);
  // `save_pretrained` always writes both; without the config the merge scale (alpha / r) is unknown.
  const configFile = weights ? findFile(files, ADAPTER_CONFIG_FILE, dirOf(weights[0])) : undefined;
  if (!weights || !configFile) {
    throw new TrainingAdapterError('noAdapter', `Training service "${serviceId}" saved no ${ADAPTER_WEIGHTS_FILE} + ${ADAPTER_CONFIG_FILE} (peft save_pretrained into bfwc.training.artifact_dir()).`);
  }
  const dir = dirOf(weights[0]);
  const config = JSON.parse(text(configFile[1])) as PeftConfig;

  const tensors = safetensorsToTensors(weights[1]);
  const a = tensorNamed(tensors, 'lora_A');
  const b = tensorNamed(tensors, 'lora_B');
  const rank = a.shape[0] ?? 0;
  const resolved = resolveBase(files, dir, base, config.base_model_name_or_path || undefined);
  const alpha = config.lora_alpha ?? config.r ?? rank;
  const lora = new EvermindLMLoRA(resolved.model, { rank, alpha });
  const { adapter } = lora;
  if (!sameShape(a.shape, [adapter.rank, adapter.cols]) || !sameShape(b.shape, [adapter.rows, adapter.rank])) {
    throw new TrainingAdapterError(
      'shapeMismatch',
      `Adapter shapes A${JSON.stringify(a.shape)} B${JSON.stringify(b.shape)} do not fit the base embedding [${adapter.rows}, ${adapter.cols}].`,
    );
  }
  adapter.A.set(a.data);
  adapter.B.set(b.data);

  const params: TrainingParams = {
    epochs: 0,
    batchSize: 0,
    learningRate: 0,
    gradientAccumulationSteps: 1,
    precision: 'float16',
    loraConfig: { rank, alpha, targetModules: [LORA_TARGET_MODULE] },
  };
  return packageBrowserLoRAArtifact({
    lora,
    model: resolved.model,
    tokenizer: resolved.tokenizer,
    modelId: resolved.modelId,
    params,
    sequenceCount: 0,
    trainingSummary: `Python training service "${serviceId}", rank ${rank}`,
  });
}

/** Read a training service's save and convert it (see {@link trainingFilesToArtifact}). */
export async function loadTrainingServiceArtifact(ref: TrainingServiceRef, base?: TrainingBaseFallback, store?: TrainingArtifactStore): Promise<BrowserLoRAArtifact> {
  return trainingFilesToArtifact(await readTrainingServiceFiles(ref, store), ref.serviceId, base);
}
