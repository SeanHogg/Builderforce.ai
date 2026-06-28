/**
 * Shared test fixture: a REAL packaged `.evermind` model + tokenizer laid into a
 * mock R2 store, built using ONLY the published engine API (no `train`, which is
 * post-2026.6.28). An untrained EvermindLM still generates a string — enough to
 * exercise the load → generate → response path end to end.
 */
import { BPETokenizer, EvermindLM, EvermindModelPackage } from '@seanhogg/builderforce-memory-engine';
import type { ArtifactStore } from '../evermindRuntime';

/** Minimal char-level tokenizer over the test corpus, via the published API. */
function buildTokenizer(): { tok: BPETokenizer; json: string } {
  const tok = new BPETokenizer();
  const vocab: Record<string, number> = {};
  let id = 0;
  for (const t of ['<unk>', '<|im_start|>', '<|im_end|>', '<|endoftext|>']) vocab[t] = id++;
  for (const ch of new Set('alpha beta gamma delta '.split(''))) vocab[ch] = id++;
  tok.loadFromObjects(vocab, []);
  return { tok, json: JSON.stringify({ vocab, merges: [] }) };
}

/** Build a mock {@link ArtifactStore} serving a valid `.evermind` + tokenizer at `ref`. */
export function buildEvermindFixtureStore(ref: string): ArtifactStore & { calls: string[] } {
  const { tok, json } = buildTokenizer();
  const lm = new EvermindLM({ vocabSize: tok.vocabSize, dModel: 12, numLayers: 1, hiddenDim: 16, seed: 7 });
  const blob = EvermindModelPackage.fromLM(lm, { name: 't', version: '1.0.0', card: { description: 'test' } }).toBlob();

  const map = new Map<string, Uint8Array | string>([
    [`${ref}/model.evermind`, new Uint8Array(blob)],
    [`${ref}/tokenizer.json`, json],
  ]);
  const calls: string[] = [];
  return {
    calls,
    async get(key: string) {
      calls.push(key);
      const v = map.get(key);
      if (v == null) return null;
      return {
        async arrayBuffer() { return typeof v === 'string' ? new TextEncoder().encode(v).buffer : (v.buffer as ArrayBuffer); },
        async text() { return typeof v === 'string' ? v : new TextDecoder().decode(v); },
      };
    },
  };
}
