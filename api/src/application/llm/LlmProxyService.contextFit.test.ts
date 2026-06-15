import { describe, expect, it } from 'vitest';
import {
  estimateRequestTokens,
  modelsFittingContext,
  pickCloudModel,
  codingModelsForPlan,
} from './LlmProxyService';
import { catalogEntry } from './vendors';

// ---------------------------------------------------------------------------
// Context-aware first-pass selection: a coding context routinely exceeds a small
// model's window (the 97K-into-32K Cloudflare 413). The selection layer keeps EVERY
// model in the pool (small-window ones are great first-pass picks for small tasks)
// but won't SEED a model whose window can't hold the request — then the SSM learned
// routing ranks the survivors. A 413 still cascades (CASCADE_STATUSES) as a net.
// ---------------------------------------------------------------------------

const SMALL_WINDOW = ['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
const BIG_WINDOW = ['@cf/zai-org/glm-4.7-flash', '@cf/moonshotai/kimi-k2.7-code'];

describe('estimateRequestTokens', () => {
  it('grows with payload size and counts tools', () => {
    const small = estimateRequestTokens([{ role: 'user', content: 'hi' }]);
    const big = estimateRequestTokens([{ role: 'user', content: 'x'.repeat(40_000) }]);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeGreaterThan(9_000); // ~40K chars / 4 ≈ 10K tokens
    // Tools add to the estimate.
    const msgs = [{ role: 'user', content: 'hi' }];
    expect(estimateRequestTokens(msgs, [{ type: 'function', function: { name: 'f', parameters: {} } }]))
      .toBeGreaterThan(estimateRequestTokens(msgs));
  });
});

describe('modelsFittingContext', () => {
  const all = [...BIG_WINDOW, ...SMALL_WINDOW, 'openai/gpt-4.1' /* unknown window */];

  it('no estimate → every model kept (no filtering)', () => {
    expect(modelsFittingContext(all)).toEqual(all);
    expect(modelsFittingContext(all, 0)).toEqual(all);
  });

  it('keeps small-window models for a SMALL request (still great first-pass picks)', () => {
    const fit = modelsFittingContext(all, 5_000);
    for (const m of SMALL_WINDOW) expect(fit).toContain(m);
  });

  it('drops small-window models for a BIG request, keeps big + unknown-window', () => {
    const fit = modelsFittingContext(all, 100_000); // need ≈ 125K with headroom
    for (const m of SMALL_WINDOW) expect(fit).not.toContain(m); // 32K / 24K can't hold it
    expect(fit).toContain('@cf/moonshotai/kimi-k2.7-code'); // 256K
    expect(fit).toContain('openai/gpt-4.1');                 // unknown window → assumed large
  });

  it('NEVER returns empty — an impossibly large request keeps the full set (cascade/413 handle it)', () => {
    const fit = modelsFittingContext(SMALL_WINDOW, 10_000_000);
    expect(fit).toEqual(SMALL_WINDOW);
  });
});

describe('pickCloudModel context-aware seed', () => {
  it('does NOT seed a small-window model for a big coding context', () => {
    const pick = pickCloudModel(undefined, 'pro', false, { estimatedTokens: 200_000 });
    expect(pick.strict).toBe(false);
    expect(SMALL_WINDOW).not.toContain(pick.model);
    // The seed's window (if known) must actually hold the request.
    const cw = catalogEntry(pick.model)?.contextWindow;
    if (cw != null) expect(cw).toBeGreaterThanOrEqual(200_000);
  });

  it('a small request can still seed a small-window model (kept in the pool)', () => {
    // With a tiny estimate every model fits, so the curated leader stands — proving
    // the small-window models were not removed, only context-gated.
    const tiny = pickCloudModel(undefined, 'pro', false, { estimatedTokens: 500 });
    expect(codingModelsForPlan('pro')).toContain(tiny.model);
  });
});
