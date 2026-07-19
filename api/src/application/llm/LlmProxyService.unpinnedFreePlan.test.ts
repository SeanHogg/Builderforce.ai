import { describe, expect, it } from 'vitest';
import {
  FREE_MODEL_POOL,
  isPremiumModelSelection,
  modelPoolForPlan,
  codingModelsForPlan,
} from './LlmProxyService';

/**
 * The seam behind the VSIX "free plan, every turn 402s" bug.
 *
 * The client used to fall back to a hardcoded `openai/gpt-4o-mini` whenever the
 * user hadn't pinned a model. That is a PAID OpenRouter model outside the free
 * pool, so an unpinned free-plan chat tripped the premium gate on EVERY turn:
 * "Premium models … require a validated card on file." The fix was to omit the
 * `model` key entirely so the gateway routes the plan's own pool.
 *
 * These tests pin the server-side half of that contract — the behaviour the fix
 * depends on. Without them, "an absent model is safe for a free tenant" is an
 * assumption about someone else's code rather than something the suite enforces.
 */
describe('unpinned request on the free plan', () => {
  // The exact ids the old client sent, and the shape the new one sends.
  const OLD_HARDCODED_FALLBACK = 'openai/gpt-4o-mini';
  const ABSENT = [undefined, null, '', '   '] as const;

  it('treats an ABSENT model as non-premium, so the gate never fires', () => {
    for (const model of ABSENT) {
      expect(isPremiumModelSelection(model, 'free')).toBe(false);
    }
  });

  it("REGRESSION: the client's old hardcoded fallback WAS premium on the free plan", () => {
    // If this ever flips to false the bug's blast radius changed — the model either
    // entered the free pool or stopped being recognised as paid. Either way the
    // comment above (and the fix's rationale) needs revisiting.
    expect(isPremiumModelSelection(OLD_HARDCODED_FALLBACK, 'free')).toBe(true);
    expect(FREE_MODEL_POOL).not.toContain(OLD_HARDCODED_FALLBACK);
  });

  it('leaves a free tenant a non-empty pool to route an unpinned turn to', () => {
    // The fix only works if omitting the model lands somewhere. An empty pool would
    // turn the 402 into a different failure rather than a working turn.
    expect(modelPoolForPlan('free').length).toBeGreaterThan(0);
    expect(codingModelsForPlan('free').length).toBeGreaterThan(0);
  });

  it('routes a free tenant only to models that carry no premium surcharge', () => {
    // Every model an unpinned free turn can land on must itself pass the gate —
    // otherwise the fix just moves the 402 one step later, into failover.
    for (const model of modelPoolForPlan('free')) {
      expect(isPremiumModelSelection(model, 'free')).toBe(false);
    }
    for (const model of codingModelsForPlan('free')) {
      expect(isPremiumModelSelection(model, 'free')).toBe(false);
    }
  });
});
