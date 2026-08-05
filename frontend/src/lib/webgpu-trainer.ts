/**
 * Browser LoRA/QLoRA training.
 *
 * Unlike the previous implementation, LoRA settings in this module are not
 * decorative: the base model is frozen and only the low-rank A/B matrices are
 * optimised. The exported artifact is a standards-compliant safetensors file.
 *
 * On WebGPU devices the adapter forward projection, exact chain-rule gradient
 * projection, and AdamW updates execute in WGSL. The compact base LM currently
 * computes its loss/backward pass on CPU; browsers without WebGPU use the exact
 * all-CPU reference path.
 */

import {
  BPETokenizer,
  EvermindLM,
  EvermindLMLoRA,
  EvermindModelPackage,
  importEvermind,
  tokenizerJson,
  tensorsToSafetensors,
  initWebGPU,
  createStorageBuffer,
  createEmptyStorageBuffer,
  createComputePipeline,
  createBindGroup,
  dispatchKernel,
  readBuffer,
  uploadBuffer,
  cdiv,
  type BaseQuant,
  type EvermindLMConfig,
} from '@seanhogg/builderforce-memory-engine';
import { hasWebGPUSupport } from '@seanhogg/builderforce-studio';
import { downloadDataset, uploadArtifact, updateTrainingJob, streamTrainingLogs } from './api';
import type { TrainingLog } from './types';

export interface LoRAConfig {
  rank: number;
  alpha: number;
  targetModules: string[];
}

export interface TrainingParams {
  epochs: number;
  batchSize: number;
  learningRate: number;
  gradientAccumulationSteps: number;
  precision: 'float16' | 'int8';
  loraConfig: LoRAConfig;
}

export interface TrainingStep {
  epoch: number;
  step: number;
  loss: number;
  learningRate: number;
}

export type TrainingDataMode = 'local-only' | 'workspace';

export interface BrowserLoRAArtifact {
  bytes: ArrayBuffer;
  filename: string;
  format: 'safetensors';
  adapterBytes: number;
  baseBytes: number;
  trainableParams: number;
  baseParams: number;
  /** Merged, self-contained runtime package used by the canonical publish route. */
  evermindPackage: ArrayBuffer;
  tokenizer: { vocab: Record<string, number>; merges: string[] };
}

export interface WebGPUTrainerOptions {
  modelId: string;
  workerUrl: string;
  projectId: string | number;
  jobId?: string;
  datasetId?: string;
  /** Local-only mode performs no dataset download, log stream, job update, or artifact upload. */
  dataMode?: TrainingDataMode;
  /** Optional portable Evermind base checkpoint. When omitted a deterministic browser base is created. */
  baseCheckpoint?: ArrayBuffer;
  /** Tokenizer paired with baseCheckpoint. A corpus tokenizer is learned when no checkpoint is supplied. */
  tokenizerSpec?: Parameters<BPETokenizer['loadHuggingFace']>[0];
  modelConfig?: Omit<EvermindLMConfig, 'vocabSize'>;
  onLog: (message: string) => void;
  onStep: (step: TrainingStep) => void;
  onEpochEnd: (epoch: number, avgLoss: number) => void;
  onArtifact?: (artifact: BrowserLoRAArtifact) => void;
  onComplete: (artifactKey: string) => void;
  onError: (error: Error) => void;
}

const BROWSER_LORA_MAX_PARAMS = 20e6;

const LORA_FORWARD_WGSL = `
@group(0) @binding(0) var<storage,read> base: array<f32>;
@group(0) @binding(1) var<storage,read> a: array<f32>;
@group(0) @binding(2) var<storage,read> b: array<f32>;
@group(0) @binding(3) var<storage,read_write> merged: array<f32>;
@group(0) @binding(4) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let rows=u32(p[0]); let cols=u32(p[1]); let rank=u32(p[2]); let idx=gid.x+gid.y*65535u*256u;
  if(idx>=rows*cols){return;} let row=idx/cols; let col=idx%cols; var delta=0.0;
  for(var k=0u;k<rank;k=k+1u){delta=delta+b[row*rank+k]*a[k*cols+col];}
  merged[idx]=base[idx]+p[3]*delta;
}`;

const LORA_BACKWARD_WGSL = `
@group(0) @binding(0) var<storage,read> gw: array<f32>;
@group(0) @binding(1) var<storage,read> a: array<f32>;
@group(0) @binding(2) var<storage,read> b: array<f32>;
@group(0) @binding(3) var<storage,read_write> ga: array<f32>;
@group(0) @binding(4) var<storage,read_write> gb: array<f32>;
@group(0) @binding(5) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let rows=u32(p[0]); let cols=u32(p[1]); let rank=u32(p[2]); let idx=gid.x; let scale=p[3];
  if(idx<rank*cols){let k=idx/cols;let col=idx%cols;var sum=0.0;for(var row=0u;row<rows;row=row+1u){sum=sum+b[row*rank+k]*gw[row*cols+col];}ga[idx]=ga[idx]+scale*sum;}
  if(idx<rows*rank){let row=idx/rank;let k=idx%rank;var sum=0.0;for(var col=0u;col<cols;col=col+1u){sum=sum+gw[row*cols+col]*a[k*cols+col];}gb[idx]=gb[idx]+scale*sum;}
}`;

const ADAMW_WGSL = `
@group(0) @binding(0) var<storage,read_write> w: array<f32>;
@group(0) @binding(1) var<storage,read_write> g: array<f32>;
@group(0) @binding(2) var<storage,read_write> m: array<f32>;
@group(0) @binding(3) var<storage,read_write> v: array<f32>;
@group(0) @binding(4) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i=gid.x;if(i>=arrayLength(&w)){return;}let grad=g[i]*p[9];let b1=p[5];let b2=p[6];
  m[i]=b1*m[i]+(1.0-b1)*grad;v[i]=b2*v[i]+(1.0-b2)*grad*grad;
  let mh=m[i]/(1.0-pow(b1,p[10]));let vh=v[i]/(1.0-pow(b2,p[10]));
  w[i]=w[i]-p[4]*(mh/(sqrt(vh)+p[7])+p[8]*w[i]);g[i]=0.0;
}`;

class WebGPULoRAAdapterEngine {
  private readonly params = new Float32Array(16);
  private readonly buffers: GPUBuffer[];
  private readonly base: GPUBuffer; private readonly a: GPUBuffer; private readonly b: GPUBuffer; private readonly merged: GPUBuffer;
  private readonly gw: GPUBuffer; private readonly ga: GPUBuffer; private readonly gb: GPUBuffer;
  private readonly ma: GPUBuffer; private readonly va: GPUBuffer; private readonly mb: GPUBuffer; private readonly vb: GPUBuffer; private readonly paramBuffer: GPUBuffer;
  private readonly forwardPipeline: GPUComputePipeline; private readonly backwardPipeline: GPUComputePipeline; private readonly updatePipeline: GPUComputePipeline;
  private stepNumber = 0;

  constructor(private readonly device: GPUDevice, private readonly lora: EvermindLMLoRA, frozenBase: Float32Array) {
    const { adapter } = lora; this.params.set([adapter.rows, adapter.cols, adapter.rank, adapter.scale]);
    this.base=createStorageBuffer(device,frozenBase);this.a=createStorageBuffer(device,adapter.A,true);this.b=createStorageBuffer(device,adapter.B,true);this.merged=createEmptyStorageBuffer(device,frozenBase.byteLength,true);
    this.gw=createEmptyStorageBuffer(device,frozenBase.byteLength);this.ga=createEmptyStorageBuffer(device,adapter.A.byteLength);this.gb=createEmptyStorageBuffer(device,adapter.B.byteLength);
    this.ma=createEmptyStorageBuffer(device,adapter.A.byteLength);this.va=createEmptyStorageBuffer(device,adapter.A.byteLength);this.mb=createEmptyStorageBuffer(device,adapter.B.byteLength);this.vb=createEmptyStorageBuffer(device,adapter.B.byteLength);this.paramBuffer=createStorageBuffer(device,this.params);
    this.buffers=[this.base,this.a,this.b,this.merged,this.gw,this.ga,this.gb,this.ma,this.va,this.mb,this.vb,this.paramBuffer];
    this.forwardPipeline=createComputePipeline(device,LORA_FORWARD_WGSL,'main');this.backwardPipeline=createComputePipeline(device,LORA_BACKWARD_WGSL,'main');this.updatePipeline=createComputePipeline(device,ADAMW_WGSL,'main');
  }
  async forward(): Promise<Float32Array> {
    const { adapter }=this.lora;const groups=cdiv(adapter.rows*adapter.cols,256);dispatchKernel(this.device,this.forwardPipeline,createBindGroup(this.device,this.forwardPipeline,[this.base,this.a,this.b,this.merged,this.paramBuffer]),[Math.min(groups,65535),Math.ceil(groups/65535),1]);
    return readBuffer(this.device,this.merged,adapter.rows*adapter.cols*4);
  }
  accumulate(gradient: Float32Array): void {
    const { adapter }=this.lora;uploadBuffer(this.device,this.gw,gradient);dispatchKernel(this.device,this.backwardPipeline,createBindGroup(this.device,this.backwardPipeline,[this.gw,this.a,this.b,this.ga,this.gb,this.paramBuffer]),[cdiv(Math.max(adapter.A.length,adapter.B.length),256),1,1]);
  }
  async step(pending: number, lr: number): Promise<void> {
    const { adapter }=this.lora;this.stepNumber+=1;this.params.set([lr,.9,.999,1e-8,.01,1/Math.max(1,pending),this.stepNumber],4);uploadBuffer(this.device,this.paramBuffer,this.params);
    dispatchKernel(this.device,this.updatePipeline,createBindGroup(this.device,this.updatePipeline,[this.a,this.ga,this.ma,this.va,this.paramBuffer]),[cdiv(adapter.A.length,256),1,1]);
    dispatchKernel(this.device,this.updatePipeline,createBindGroup(this.device,this.updatePipeline,[this.b,this.gb,this.mb,this.vb,this.paramBuffer]),[cdiv(adapter.B.length,256),1,1]);
    const [a,b]=await Promise.all([readBuffer(this.device,this.a,adapter.A.byteLength),readBuffer(this.device,this.b,adapter.B.byteLength)]);adapter.A.set(a);adapter.B.set(b);
  }
  destroy(): void { for(const buffer of this.buffers) buffer.destroy(); }
}

export function canTrainInBrowser(maxParams: number): boolean {
  return maxParams <= BROWSER_LORA_MAX_PARAMS;
}

/** Conservative browser limit based on the exact-gradient implementation. */
export function shouldUseWebGPU(maxParams: number): boolean {
  return hasWebGPUSupport() && canTrainInBrowser(maxParams);
}

function parseJsonl(jsonl: string): string[] {
  return jsonl.split('\n').filter(Boolean).map((line) => {
    try {
      const ex = JSON.parse(line) as { instruction?: string; input?: string; output?: string };
      return [ex.instruction, ex.input, ex.output].filter(Boolean).join('\n').trim();
    } catch {
      return line.trim();
    }
  }).filter(Boolean);
}

function safeModelName(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Convert a real LoRA adapter to the PEFT-compatible safetensors container. */
export function exportLoRASafetensors(
  lora: EvermindLMLoRA,
  modelId: string,
  targetModule = 'embed_tokens',
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

/** Real frozen-base LoRA trainer retained under the old export name for API compatibility. */
export class WebGPUTrainer {
  private stopped = false;
  private ready = false;
  private gpuDevice: GPUDevice | null = null;
  private readonly options: WebGPUTrainerOptions;

  constructor(options: WebGPUTrainerOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    this.options.onLog('Initialising exact-gradient browser LoRA engine…');
    if (hasWebGPUSupport()) {
      try { this.gpuDevice = (await initWebGPU({ powerPreference: 'high-performance' })).device; }
      catch { this.gpuDevice = null; }
    }
    this.ready = true;
    this.options.onLog(
      this.gpuDevice
        ? 'Browser LoRA ready (WGSL adapter forward/backward/AdamW; CPU base-model autograd).'
        : 'Browser LoRA ready (CPU exact gradients).',
    );
  }

  stop(): void {
    this.stopped = true;
    this.options.onLog('Training stop requested…');
  }

  async train(params: TrainingParams, localExamples: string[]): Promise<void> {
    if (!this.ready) throw new Error('Trainer not initialised. Call init() first.');
    this.stopped = false;
    const mode = this.options.dataMode ?? 'workspace';

    try {
      let examples = localExamples.map((item) => item.trim()).filter(Boolean);
      if (mode === 'workspace' && this.options.datasetId) {
        this.options.onLog(`Fetching workspace dataset ${this.options.datasetId}…`);
        examples = parseJsonl(await downloadDataset(this.options.datasetId));
      }
      if (examples.length === 0) throw new Error('No training text available.');

      if (mode === 'workspace' && this.options.jobId) {
        streamTrainingLogs(this.options.jobId, (log: TrainingLog) => {
          if (log.message) this.options.onLog(`[server] ${log.message}`);
        }).catch(() => undefined);
      }

      const tokenizer = new BPETokenizer();
      if (this.options.tokenizerSpec) tokenizer.loadHuggingFace(this.options.tokenizerSpec);
      else tokenizer.train(examples, { numMerges: Math.min(512, Math.max(64, examples.length * 8)) });

      const model = this.options.baseCheckpoint
        ? importEvermind(new Uint8Array(this.options.baseCheckpoint))
        : new EvermindLM({
            vocabSize: tokenizer.vocabSize,
            dModel: 96,
            numLayers: 2,
            hiddenDim: 192,
            seed: 0x42f0ce,
            ...this.options.modelConfig,
          });
      if (model.config.vocabSize !== tokenizer.vocabSize) {
        throw new Error(`Tokenizer vocabulary (${tokenizer.vocabSize}) does not match base model (${model.config.vocabSize}).`);
      }

      const quant: BaseQuant = params.precision === 'int8' ? 'int8' : 'fp16';
      const lora = new EvermindLMLoRA(model, {
        rank: params.loraConfig.rank,
        alpha: params.loraConfig.alpha,
        baseQuant: quant,
        seed: 0x10a0,
      });
      const sequences = examples.map((text) => tokenizer.encode(text, { addBos: true, addEos: true })).filter((s) => s.length > 1);
      if (sequences.length === 0) throw new Error('Tokenizer produced no trainable sequences.');

      const before = Float32Array.from(model.emb);
      const gpuAdapter = this.gpuDevice ? new WebGPULoRAAdapterEngine(this.gpuDevice, lora, lora.mergedEmb()) : null;
      this.options.onLog(`Training ${lora.adapter.numParams().toLocaleString()} adapter parameters; base weights are frozen.`);
      for (let epoch = 1; epoch <= params.epochs; epoch += 1) {
        if (this.stopped) { gpuAdapter?.destroy(); return; }
        let loss = 0;
        if (gpuAdapter) {
          let total = 0, count = 0, pending = 0;
          const flush = async () => { if (pending) { await gpuAdapter.step(pending, params.learningRate); pending = 0; } };
          for (const sequence of sequences) {
            if (this.stopped) break;
            const merged = await gpuAdapter.forward();
            const saved = model.emb;
            try {
              model.emb = merged;
              model.zeroGrad();
              total += model.lossAndBackward(sequence);
              gpuAdapter.accumulate(Float32Array.from(model.gradients()[0]!.data));
            } finally { model.emb = saved; }
            count += 1; pending += 1;
            if (pending >= Math.max(1, params.gradientAccumulationSteps)) await flush();
          }
          await flush();
          loss = count ? total / count : 0;
        } else {
          [loss = 0] = lora.fit(sequences, { epochs: 1, lr: params.learningRate, accumSteps: Math.max(1, params.gradientAccumulationSteps) });
        }
        const step = { epoch, step: epoch, loss, learningRate: params.learningRate };
        this.options.onStep(step);
        this.options.onEpochEnd(epoch, loss);
        this.options.onLog(`Epoch ${epoch}/${params.epochs} — loss ${loss.toFixed(4)}`);
        if (mode === 'workspace' && this.options.jobId) {
          await updateTrainingJob(this.options.jobId, { status: 'running', currentEpoch: epoch, currentLoss: loss });
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      gpuAdapter?.destroy();

      if (model.emb.some((value, index) => value !== before[index])) {
        throw new Error('Frozen-base invariant failed: base weights changed during LoRA training.');
      }

      const bytes = exportLoRASafetensors(lora, this.options.modelId, 'embed_tokens', params.precision === 'float16');
      const footprint = lora.footprint();
      const filename = `${safeModelName(this.options.modelId)}-adapter.safetensors`;
      const mergedModel = new EvermindLM(model.config);
      mergedModel.loadWeights(lora.merge({ fp16: false }));
      const evermindPackage = EvermindModelPackage.fromLM(mergedModel, {
        name: this.options.modelId,
        version: `1.0.${Date.now()}`,
        fp16: params.precision === 'float16',
        createdAt: new Date().toISOString(),
        card: {
          description: `Browser-trained LoRA merge for ${this.options.modelId}`,
          trainingSummary: `${sequences.length} sequences, ${params.epochs} epochs, rank ${params.loraConfig.rank}`,
          tags: ['builderforce', 'browser-lora', 'evermind'],
        },
      }).toBlob();
      const portableTokenizer = tokenizerJson(tokenizer) as { model?: { vocab?: Record<string, number>; merges?: string[] } };
      if (!portableTokenizer.model?.vocab || !portableTokenizer.model.merges) throw new Error('Could not package the trained tokenizer.');
      const artifact: BrowserLoRAArtifact = {
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        filename,
        format: 'safetensors',
        evermindPackage,
        tokenizer: { vocab: portableTokenizer.model.vocab, merges: portableTokenizer.model.merges },
        ...footprint,
      };
      this.options.onArtifact?.(artifact);

      let artifactKey = `local://${filename}`;
      if (mode === 'workspace' && this.options.jobId) {
        const result = await uploadArtifact(this.options.jobId, artifact.bytes, {
          format: 'safetensors',
          filename,
          baseModel: this.options.modelId,
          rank: params.loraConfig.rank,
          alpha: params.loraConfig.alpha,
        });
        artifactKey = result.r2Key;
        await updateTrainingJob(this.options.jobId, { status: 'completed', currentEpoch: params.epochs, r2ArtifactKey: artifactKey });
      }
      this.options.onLog(`LoRA adapter ready: ${artifactKey}`);
      this.options.onComplete(artifactKey);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((this.options.dataMode ?? 'workspace') === 'workspace' && this.options.jobId) {
        await updateTrainingJob(this.options.jobId, { status: 'failed', errorMessage: err.message }).catch(() => undefined);
      }
      this.options.onError(err);
      throw err;
    }
  }

  destroy(): void {
    this.stopped = true;
    this.ready = false;
  }
}

export { WebGPUTrainer as BrowserLoRATrainer };
