/**
 * THE IDEMPOTENCY KEY — the one thing that decides whether a customer is billed
 * once or twice for the same month.
 *
 * `recordExtensionSale` is protected by two unique indexes (`uq_orders_number` and
 * `uq_ledger_entries_reference`), and both are keyed on the occurrence. That protection
 * is worth exactly as much as the occurrence's two properties: the SAME transaction
 * always composes the same value, and two DIFFERENT transactions never do. These are
 * those two properties, asserted on the constructors that build it.
 */

import { describe, expect, it } from 'vitest';
import {
  assertOccurrence,
  orderNumberFor,
  subscriptionOccurrence,
  usageOccurrence,
} from './extensionEarnings';

const INSTALL = '11111111-2222-4333-8444-555555555555';
const OTHER = 'aaaaaaaa-2222-4333-8444-555555555555';

describe('usageOccurrence — the same window is the same key', () => {
  it('is stable across two closes of the same window, seconds apart', () => {
    // THE regression this exists for. An occurrence derived from `now` instead of
    // the watermark gives a retry a new key, and the customer is billed twice for
    // one month with nothing in the data to say it happened.
    const start = Date.UTC(2026, 7, 1, 9, 30, 0);
    expect(usageOccurrence(INSTALL, start)).toBe(usageOccurrence(INSTALL, start));
  });

  it('ignores sub-second drift in the window start', () => {
    const start = Date.UTC(2026, 7, 1, 9, 30, 0);
    expect(usageOccurrence(INSTALL, start + 999)).toBe(usageOccurrence(INSTALL, start));
  });

  it('differs for the NEXT window on the same install', () => {
    const start = Date.UTC(2026, 7, 1);
    const next = Date.UTC(2026, 8, 1);
    expect(usageOccurrence(INSTALL, next)).not.toBe(usageOccurrence(INSTALL, start));
  });

  it('differs for two installs closing in the same second', () => {
    // Both orders land on the same tenant when one workspace runs two paid
    // extensions, so a collision here would drop one publisher's revenue.
    const start = Date.UTC(2026, 7, 1);
    expect(usageOccurrence(INSTALL, start)).not.toBe(usageOccurrence(OTHER, start));
  });

  it('tolerates a missing watermark rather than throwing mid-sweep', () => {
    expect(() => assertOccurrence(usageOccurrence(INSTALL, 0))).not.toThrow();
    expect(() => assertOccurrence(usageOccurrence(INSTALL, -1))).not.toThrow();
  });

  it('fits the order-number column with room to spare', () => {
    // `orders.order_number` is varchar(48) and the prefix costs four.
    const number = orderNumberFor(usageOccurrence(INSTALL, Date.UTC(2999, 0, 1)));
    expect(number.length).toBeLessThanOrEqual(48);
    expect(number.startsWith('EXT-U')).toBe(true);
  });
});

describe('subscriptionOccurrence — the entropy is at the tail', () => {
  it('distinguishes two sessions that share the whole standard prefix', () => {
    // Every Stripe session id on this platform begins `cs_live_` / `cs_test_`, so
    // a LEADING slice would be the same forty characters for every customer.
    const a = subscriptionOccurrence('cs_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6AAAA');
    const b = subscriptionOccurrence('cs_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6BBBB');
    expect(a).not.toBe(b);
  });

  it('is stable for the same session, so a retried completion collides', () => {
    expect(subscriptionOccurrence('cs_test_abc123')).toBe(subscriptionOccurrence('cs_test_abc123'));
  });

  it('fits the order-number column even for a maximal session id', () => {
    const number = orderNumberFor(subscriptionOccurrence(`cs_live_${'x'.repeat(120)}`));
    expect(number.length).toBeLessThanOrEqual(48);
    expect(number.startsWith('EXT-S')).toBe(true);
  });

  it('cannot be confused with a usage occurrence', () => {
    // Different first letter by construction, so a subscription and a usage close
    // on the same install can never compose the same order number.
    expect(subscriptionOccurrence('cs_test_1')[0]).toBe('S');
    expect(usageOccurrence(INSTALL, 0)[0]).toBe('U');
  });
});

describe('assertOccurrence — refuses anything hand-built', () => {
  it('rejects lower case, punctuation and anything over the column budget', () => {
    // Throwing beats truncating: a truncated order number is a silently dropped
    // charge, and between a wrong answer and no answer, money takes no answer.
    expect(() => assertOccurrence('usage:some-install:1234')).toThrow();
    expect(() => assertOccurrence('')).toThrow();
    expect(() => assertOccurrence('A'.repeat(45))).toThrow();
    expect(() => assertOccurrence('A'.repeat(44))).not.toThrow();
  });
});
