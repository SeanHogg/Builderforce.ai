/**
 * Shared test fixture: a REAL trained, packaged `.evermind` model + tokenizer laid
 * into a mock R2 store. Exercises the published engine end to end — including
 * `BPETokenizer.train` (shipped in @seanhogg/builderforce-memory-engine 2026.6.31)
 * — so the serving path (load → generate → response) is tested against a genuinely
 * trained artifact, not a hand-built stub.
 */
import { BPETokenizer, EvermindLM, EvermindLMTrainer, EvermindModelPackage, VideoRVQCodec } from '@seanhogg/builderforce-memory-engine';
import type { ArtifactStore } from '../evermindRuntime';

/** Build a mock {@link ArtifactStore} serving a trained `.evermind` + tokenizer at `ref`. */
export function buildEvermindFixtureStore(ref: string): ArtifactStore & { calls: string[] } {
  const corpus = 'alpha beta gamma. beta gamma delta. gamma delta alpha. delta alpha beta.';
  const tok = new BPETokenizer();
  tok.train(corpus, { numMerges: 30 });
  const seqs = corpus.split(/(?<=\.)\s+/).map((s) => tok.encode(s.trim())).filter((s) => s.length >= 2);
  const lm = new EvermindLM({ vocabSize: tok.vocabSize, dModel: 12, numLayers: 1, hiddenDim: 16, seed: 7 });
  new EvermindLMTrainer(lm, { lr: 0.03, epochs: 8 }).fit(seqs);

  const blob = EvermindModelPackage.fromLM(lm, { name: 't', version: '1.0.0', card: { description: 'test' } }).toBlob();
  const tokenizerJson = JSON.stringify({ vocab: Object.fromEntries(tok.vocab), merges: [...tok.merges.keys()] });

  const map = new Map<string, Uint8Array | string>([
    [`${ref}/model.evermind`, new Uint8Array(blob)],
    [`${ref}/tokenizer.json`, tokenizerJson],
  ]);
  return mockStore(map);
}

/**
 * Build a mock {@link ArtifactStore} serving a self-contained VIDEO/IMAGE
 * `.evermind` at `ref` — the codec is bundled INSIDE the artifact (via
 * `fromMediaLM`), so no separate tokenizer file is written. Exercises the media
 * serving path (loadMediaLM → generateVideo → decode) against a real artifact.
 */
export function buildEvermindMediaFixtureStore(
  ref: string,
  modality: 'video' | 'image' = 'video',
): ArtifactStore & { calls: string[] } {
  const H = 8, W = 8, C = 3;
  const codec = new VideoRVQCodec({ height: H, width: W, channels: C, patch: 4, levels: 1, codebookSize: 8, seed: 5 });
  const frame = (t: number) => {
    const f = new Float32Array(H * W * C);
    for (let i = 0; i < f.length; i++) f[i] = ((i + t) % 7) / 7;
    return f;
  };
  const clip = modality === 'image' ? [frame(0)] : [frame(0), frame(1), frame(2)];
  codec.fit([clip], { iterations: 4 });
  const lm = new EvermindLM({ vocabSize: codec.vocabSize, dModel: 12, numLayers: 1, hiddenDim: 16, seed: 7 });
  // Overfit the clip's token stream so generation reliably emits a video sequence.
  new EvermindLMTrainer(lm, { lr: 0.05, epochs: 120 }).fit([codec.encode(clip)]);

  const blob = EvermindModelPackage.fromMediaLM(lm, codec, {
    name: 'media', version: '1.0.0', modality, card: { description: 'test media model' },
  }).toBlob();

  return mockStore(new Map<string, Uint8Array | string>([[`${ref}/model.evermind`, new Uint8Array(blob)]]));
}

/** Wrap a key→bytes map as a call-recording {@link ArtifactStore}. */
function mockStore(map: Map<string, Uint8Array | string>): ArtifactStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(key: string) {
      calls.push(key);
      const v = map.get(key);
      if (v == null) return null;
      return {
        async arrayBuffer() { return (typeof v === 'string' ? new TextEncoder().encode(v).buffer : v.buffer) as ArrayBuffer; },
        async text() { return typeof v === 'string' ? v : new TextDecoder().decode(v); },
      };
    },
  };
}
