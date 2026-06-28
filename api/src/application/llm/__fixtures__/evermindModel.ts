/**
 * Shared test fixture: a REAL trained, packaged `.evermind` model + tokenizer laid
 * into a mock R2 store. Exercises the published engine end to end — including
 * `BPETokenizer.train` (shipped in @seanhogg/builderforce-memory-engine 2026.6.31)
 * — so the serving path (load → generate → response) is tested against a genuinely
 * trained artifact, not a hand-built stub.
 */
import { BPETokenizer, EvermindLM, EvermindLMTrainer, EvermindModelPackage } from '@seanhogg/builderforce-memory-engine';
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
