import { describe, expect, it } from 'vitest';
import { CLOUD_ORDERS, isCloudOrder } from './cloudOrder';

describe('isCloudOrder', () => {
  it('accepts exactly the three orders', () => {
    for (const order of CLOUD_ORDERS) expect(isCloudOrder(order)).toBe(true);
    expect(isCloudOrder('auto')).toBe(false);
    expect(isCloudOrder(undefined)).toBe(false);
  });
});
