import { describe, expect, it } from 'vitest';
import {
  BUILDERFORCE_PRODUCT_NAME,
  DEFAULT_MODEL_IDENTITY,
  displayModelName,
  productForPlan,
  productModelName,
  revealsModelId,
  type ModelIdentityContext,
} from './modelIdentity';

const FREE: ModelIdentityContext = { product: 'free', canChoose: false };
const PAID: ModelIdentityContext = { product: 'pro', canChoose: true };
/** Free plan, but a connected provider — they may pin, so they own the choice. */
const FREE_WITH_BYO: ModelIdentityContext = { product: 'free', canChoose: true };

describe('displayModelName', () => {
  it('masks every upstream id behind the product for a routed, choice-less viewer', () => {
    for (const id of ['minimaxai/minimax-m3', '@cf/zai-org/glm-4.7-flash', 'anthropic/claude-sonnet-5']) {
      expect(displayModelName(id, FREE)).toBe(BUILDERFORCE_PRODUCT_NAME.free);
    }
  });

  it('names the model for a viewer who may pick one', () => {
    expect(displayModelName('anthropic/claude-sonnet-5', PAID)).toBe('anthropic/claude-sonnet-5');
    expect(displayModelName('direct/meta/muse-spark-1.1', FREE_WITH_BYO)).toBe('direct/meta/muse-spark-1.1');
  });

  it('always names a turn served by the tenant’s OWN connected account', () => {
    // Connecting an account is precisely so the model you connected gets used and
    // named; masking it would defeat the feature — and the plan is irrelevant, since
    // the tenant, not BuilderForce, paid for the call.
    expect(displayModelName('claude-opus-5', FREE, { account: 'own' })).toBe('claude-opus-5');
  });

  it('keeps naming a shared-pool turn as the product even when BYO went unused', () => {
    // `shared_byo_unused` still means OUR pool served it — the chip flags the unused
    // account separately; the model name stays the product.
    expect(displayModelName('minimaxai/minimax-m3', FREE, { account: 'shared_byo_unused' }))
      .toBe(BUILDERFORCE_PRODUCT_NAME.free);
  });

  it('never masks a ref the user configured themselves', () => {
    expect(displayModelName('project_evermind:12', FREE)).toBe('project_evermind:12');
    expect(displayModelName('tenant_model:reviewer', FREE)).toBe('tenant_model:reviewer');
  });

  it('falls back to the product for a missing model and for an unwired host', () => {
    expect(displayModelName(null, PAID)).toBe(BUILDERFORCE_PRODUCT_NAME.pro);
    expect(displayModelName('   ', FREE)).toBe(BUILDERFORCE_PRODUCT_NAME.free);
    // Forgetting to wire an identity must fail CLOSED (masked), never open.
    expect(displayModelName('minimaxai/minimax-m3', undefined)).toBe(BUILDERFORCE_PRODUCT_NAME.free);
    expect(DEFAULT_MODEL_IDENTITY).toEqual({ product: 'free', canChoose: false });
  });
});

describe('product naming', () => {
  it('maps a paid plan to PRO and everything else to Free', () => {
    expect(productForPlan(true)).toBe('pro');
    expect(productForPlan(false)).toBe('free');
    expect(productModelName({ product: productForPlan(true), canChoose: true })).toBe('Builderforce PRO');
    expect(productModelName({ product: productForPlan(false), canChoose: false })).toBe('Builderforce Free');
  });

  it('reveals ids exactly when the viewer owns the choice', () => {
    expect(revealsModelId(FREE)).toBe(false);
    expect(revealsModelId(FREE, 'own')).toBe(true);
    expect(revealsModelId(PAID)).toBe(true);
  });
});
