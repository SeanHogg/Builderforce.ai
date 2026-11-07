import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ window: vi.fn() }));
vi.mock('../ratelimit/slidingWindow', () => ({ checkSlidingWindow: mocks.window }));

import { TRANSLATE_GLOBAL_DAILY_CHARS, TRANSLATE_TENANT_DAILY_CHARS, spendTranslateBudget } from './translateBudget';

const ok = { allowed: true, current: 1, limit: 1, resetAt: 'x', retryAfterSeconds: 1 };
const no = { ...ok, allowed: false };

beforeEach(() => mocks.window.mockReset());

describe('spendTranslateBudget', () => {
  it('charges the chars against tenant then global over 24h', async () => {
    mocks.window.mockResolvedValue(ok);
    expect(await spendTranslateBudget({}, 7, 120)).toBeNull();
    expect(mocks.window).toHaveBeenNthCalledWith(1, {}, 'translate-chars:t:7', TRANSLATE_TENANT_DAILY_CHARS, 86_400_000, 120);
    expect(mocks.window).toHaveBeenNthCalledWith(2, {}, 'translate-chars:global', TRANSLATE_GLOBAL_DAILY_CHARS, 86_400_000, 120);
  });
  it('refuses on the tenant budget without touching the global one', async () => {
    mocks.window.mockResolvedValueOnce(no);
    expect(await spendTranslateBudget({}, 7, 5)).toEqual(no);
    expect(mocks.window).toHaveBeenCalledTimes(1);
  });
  it('refuses on the global budget', async () => {
    mocks.window.mockResolvedValueOnce(ok).mockResolvedValueOnce(no);
    expect(await spendTranslateBudget({}, 7, 5)).toEqual(no);
  });
  it('fails closed when the limiter is unavailable', async () => {
    mocks.window.mockResolvedValue(null);
    const v = await spendTranslateBudget({}, 7, 5);
    expect(v).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
  });
  it('fails closed when only the global limiter is unavailable', async () => {
    mocks.window.mockResolvedValueOnce(ok).mockResolvedValueOnce(null);
    expect(await spendTranslateBudget({}, 7, 5)).toMatchObject({ allowed: false });
  });
});
