import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { miniTest, quantize, writeBundle, type QuantizedTensor } from '@webdit/convert';
import { loadBundleFromBuffers, type LoadedBundle } from '@webdit/runtime';
import type { WebDiTManifest } from '@webdit/shared';
import { generateWebDitClip } from './webdit-engine';
import type { MambaStateSnapshot } from '../types';

/**
 * generateWebDitClip's frame→mux conversion, exercised against the same
 * synthetic mini-test bundle webdit/runtime's own integration test builds
 * (real quantized shard bytes flowing through a real pure-JS forward pass —
 * the "mini" backend exists specifically so this needs no GPU/network). No
 * real webdit bundle exists yet (all 4 production models are `available:
 * false` — see MODEL_REGISTRY), so this is the only way to exercise the
 * webdit generation path end-to-end today.
 *
 * The browser APIs `generateWebDitClip` → `muxFramesToMp4` depend on
 * (ImageData / createImageBitmap / VideoFrame / VideoEncoder /
 * EncodedVideoChunk) don't exist in vitest's default node environment, so
 * this file stubs minimal, structurally-correct fakes for them — mirroring
 * how webcodecs-muxer.test.ts injects a fake VideoEncoderConfigProbe rather
 * than requiring a real browser. The fakes are deliberately trivial (no real
 * H.264 encoding) — this test asserts the DATA FLOW (N frames in → N frames
 * muxed, mambaState/prompt/activeDevice passed through correctly), not that
 * the resulting MP4 bytes are a playable video.
 */

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

class FakeImageBitmap {
  closed = false;
  constructor(
    public width: number,
    public height: number,
  ) {}
  close() {
    this.closed = true;
  }
}

async function fakeCreateImageBitmap(source: FakeImageData): Promise<FakeImageBitmap> {
  return new FakeImageBitmap(source.width, source.height);
}

class FakeVideoFrame {
  timestamp: number;
  duration: number;
  closed = false;
  constructor(_source: unknown, init: { timestamp: number; duration: number }) {
    this.timestamp = init.timestamp;
    this.duration = init.duration;
  }
  close() {
    this.closed = true;
  }
}

class FakeEncodedVideoChunk {
  type: 'key' | 'delta';
  timestamp: number;
  duration: number;
  byteLength: number;
  private bytes: Uint8Array;
  constructor(init: { type: 'key' | 'delta'; timestamp: number; duration: number; data: BufferSource }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    this.bytes =
      init.data instanceof ArrayBuffer ? new Uint8Array(init.data) : new Uint8Array(init.data.buffer as ArrayBuffer);
    this.byteLength = this.bytes.byteLength;
  }
  copyTo(destination: ArrayBuffer | ArrayBufferView): void {
    const target =
      destination instanceof ArrayBuffer
        ? new Uint8Array(destination)
        : new Uint8Array(destination.buffer, destination.byteOffset, destination.byteLength);
    target.set(this.bytes);
  }
}

class FakeVideoEncoder {
  static async isConfigSupported(config: { codec: string }): Promise<{ supported: boolean }> {
    // Match the muxer's first (most-compatible) candidate only — enough to
    // exercise selectVideoCodec's real probing loop without over-fitting.
    return { supported: config.codec === 'avc1.42001f' };
  }

  private output: (chunk: FakeEncodedVideoChunk, meta: unknown) => void;
  encodeCallCount = 0;

  constructor(init: { output: (chunk: FakeEncodedVideoChunk, meta: unknown) => void; error: (e: Error) => void }) {
    this.output = init.output;
  }

  configure(_config: unknown): void {}

  encode(frame: FakeVideoFrame, opts?: { keyFrame?: boolean }): void {
    this.encodeCallCount++;
    const chunk = new FakeEncodedVideoChunk({
      type: opts?.keyFrame ? 'key' : 'delta',
      timestamp: frame.timestamp,
      duration: frame.duration,
      data: new Uint8Array([0, 0, 0, 1]).buffer,
    });
    this.output(chunk, {
      decoderConfig: {
        codec: 'avc1.42001f',
        codedWidth: 8,
        codedHeight: 8,
        description: new Uint8Array([0, 0, 0, 0]).buffer,
      },
    });
  }

  async flush(): Promise<void> {}
  close(): void {}
}

function installBrowserPolyfills(): () => void {
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('createImageBitmap', fakeCreateImageBitmap);
  vi.stubGlobal('VideoFrame', FakeVideoFrame);
  vi.stubGlobal('EncodedVideoChunk', FakeEncodedVideoChunk);
  vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
  return () => vi.unstubAllGlobals();
}

/** Builds the same synthetic mini-test bundle webdit/runtime's
 *  test/integration.test.ts builds (real quantized shard bytes via the real
 *  `writeBundle`), then reads every manifest-referenced file back into an
 *  in-memory buffer map — the shape `loadBundleFromBuffers` (and, in
 *  production, studio's own weight-cache-backed `loadWebDitBundle`) expects. */
async function buildMiniBundle(): Promise<{ manifest: WebDiTManifest; files: Record<string, ArrayBuffer>; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-webdit-'));
  const out = path.join(root, 'bundle');
  const stub = path.join(root, 'stub');
  await fs.mkdir(stub, { recursive: true });
  await fs.writeFile(path.join(stub, 'dit.onnx'), 'MINI_DIT_PLACEHOLDER');
  await fs.writeFile(path.join(stub, 'te.onnx'), 'MINI_TE_PLACEHOLDER');
  await fs.writeFile(path.join(stub, 'vae.onnx'), 'MINI_VAE_PLACEHOLDER');
  await fs.mkdir(path.join(stub, 'tokenizer'), { recursive: true });
  await fs.writeFile(path.join(stub, 'tokenizer/tokenizer.json'), '{}');

  const ditWeights = new Map<string, QuantizedTensor>([
    ['dit.scale', quantize(new Float32Array([0.5, 0.4, 0.3, 0.2]), [4], 'f16')],
    ['dit.bias', quantize(new Float32Array([0.0, 0.1, 0.0, -0.1]), [4], 'f16')],
  ]);
  const teData = new Float32Array(64 * 8);
  for (let i = 0; i < teData.length; i++) teData[i] = Math.sin(i * 0.1) * 0.2;
  const teWeights = new Map<string, QuantizedTensor>([['te.proj', quantize(teData, [64, 8], 'f16')]]);
  const vaeWeights = new Map<string, QuantizedTensor>([
    [
      'vae.proj',
      quantize(
        new Float32Array([0.8, -0.1, 0.2, 0.05, 0.1, 0.7, -0.2, 0.0, -0.05, 0.15, 0.6, 0.1]),
        [3, 4],
        'f16',
      ),
    ],
  ]);

  const manifest = await writeBundle({
    output: out,
    manifest: miniTest.buildManifest('f16'),
    ditWeights,
    textEncoderWeights: teWeights,
    vaeWeights,
    graphs: {
      dit: path.join(stub, 'dit.onnx'),
      textEncoder: path.join(stub, 'te.onnx'),
      vae: path.join(stub, 'vae.onnx'),
    },
    tokenizerDir: path.join(stub, 'tokenizer'),
  });

  const relPaths = [
    manifest.files.ditGraph,
    ...manifest.files.ditWeightShards,
    manifest.files.textEncoderGraph,
    manifest.files.textEncoderWeights,
    manifest.files.vaeGraph,
    manifest.files.vaeWeights,
  ];
  const files: Record<string, ArrayBuffer> = {};
  for (const rel of relPaths) {
    const buf = await fs.readFile(path.join(out, rel));
    files[rel] = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  return { manifest, files, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

describe('generateWebDitClip (frame → mux conversion, mini backend fixture)', () => {
  let fix: Awaited<ReturnType<typeof buildMiniBundle>>;
  let bundle: LoadedBundle;
  let restoreGlobals: () => void;

  beforeEach(async () => {
    restoreGlobals = installBrowserPolyfills();
    fix = await buildMiniBundle();
    bundle = await loadBundleFromBuffers(fix.manifest, fix.files);
  });

  afterEach(async () => {
    await bundle.unload();
    await fix.cleanup();
    restoreGlobals();
  });

  const mambaState: MambaStateSnapshot = { data: [], dim: 1, order: 1, channels: 1, step: 0 };

  it('produces one muxed MP4 blob and one ImageBitmap per generated frame', async () => {
    const result = await generateWebDitClip(bundle, {
      prompt: 'hello world',
      frames: 4,
      fps: 8,
      steps: 2,
      guidance: 0,
      seed: 42,
      width: 8,
      height: 8,
      mambaState,
    });

    expect(result.frames).toHaveLength(4);
    for (const bitmap of result.frames) {
      expect(bitmap).toBeInstanceOf(FakeImageBitmap);
      expect((bitmap as unknown as FakeImageBitmap).width).toBe(8);
      expect((bitmap as unknown as FakeImageBitmap).height).toBe(8);
    }
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('video/mp4');
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.activeDevice).toBe('webgpu');
    expect(result.resolvedPrompt).toBe('hello world');
    expect(result.elapsedMs).toBeGreaterThan(0);
  });

  it('passes mambaState through UNCHANGED (webdit is a no-op for Mamba state)', async () => {
    const result = await generateWebDitClip(bundle, {
      prompt: 'x',
      frames: 4,
      fps: 8,
      steps: 2,
      seed: 1,
      width: 8,
      height: 8,
      mambaState,
    });
    expect(result.mambaState).toBe(mambaState); // same reference — no mutation, no new object
  });

  it('calls onFrame once per frame, in order, with the frame index and passthrough mambaState', async () => {
    const calls: Array<{ idx: number; state: MambaStateSnapshot }> = [];
    await generateWebDitClip(bundle, {
      prompt: 'x',
      frames: 4,
      fps: 8,
      steps: 2,
      seed: 1,
      width: 8,
      height: 8,
      mambaState,
      onFrame: (idx, _bitmap, state) => calls.push({ idx, state }),
    });
    expect(calls.map((c) => c.idx)).toEqual([0, 1, 2, 3]);
    for (const c of calls) expect(c.state).toBe(mambaState);
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateWebDitClip(bundle, {
        prompt: 'x',
        frames: 4,
        fps: 8,
        steps: 2,
        seed: 1,
        width: 8,
        height: 8,
        mambaState,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/i);
  });
});
