import { describe, it, expect } from 'vitest';
import { EvermindLM } from '@seanhogg/builderforce-memory-engine';
import { embedForRecall, packVec, unpackVec, EMBED_MAX_TOKENS } from './evermindEmbed';

describe('embedForRecall', () => {
  const lm = new EvermindLM({ vocabSize: 48, seed: 7 });
  const tok = { encode: (text: string) => Array.from(text).map((c) => c.charCodeAt(0) % 48) };

  it('returns a dModel-length, L2-normalised vector, deterministically', () => {
    const a = embedForRecall(lm, tok, 'hello world');
    const b = embedForRecall(lm, tok, 'hello world');
    expect(a.length).toBe(lm.config.dModel);
    let norm = 0;
    for (const x of a) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('caps the tokens fed to the model', () => {
    const long = 'x'.repeat(EMBED_MAX_TOKENS * 3);
    const capped = 'x'.repeat(EMBED_MAX_TOKENS);
    expect(Array.from(embedForRecall(lm, tok, long))).toEqual(Array.from(embedForRecall(lm, tok, capped)));
  });
});

describe('packVec / unpackVec', () => {
  it('round-trips a Float32 embedding losslessly', () => {
    const v = Float32Array.from([0.1, -0.25, 0.5, 0, 0.999, -1]);
    expect(Array.from(unpackVec(packVec(v)))).toEqual(Array.from(v));
  });

  it('returns an empty vector for malformed base64', () => {
    expect(unpackVec('not-base64-!!!').length).toBe(0);
  });
});
