import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { WebhookEvent } from '../../infrastructure/payment/PaymentProvider';
import { fakeDb } from '../../../test/fakeDb';
import { addonRecorderFor } from '../billing/purchaseRegistry';
import {
  getManagedAgentHostSubscription,
  managedAgentHostCheckoutBlock,
  managedAgentHostProvisionBlock,
  managedAgentHostQuantity,
  managedAgentHostRequestBlock,
  occupyingManagedAgentHostCount,
  provisionManagedAgentHostRequest,
  recordManagedAgentHostEvent,
} from './managedAgentHostSubscription';

function event(over: Partial<WebhookEvent> & Pick<WebhookEvent, 'type'>): WebhookEvent {
  return {
    type: over.type,
    purchaseKind: 'managed_agent_host',
    tenantId: 7,
    externalCustomerId: 'cus_host',
    externalSubscriptionId: 'sub_host',
    cartId: 'cart-host',
    monthlyCents: 4900,
    metadata: { quantity: '2', monthlyCents: '4900' },
    ...over,
  } as WebhookEvent;
}

describe('managedAgentHostQuantity', () => {
  it('clamps to 1–99', () => {
    expect(managedAgentHostQuantity(3)).toBe(3);
    expect(managedAgentHostQuantity('4')).toBe(4);
    expect(managedAgentHostQuantity(0)).toBe(1);
    expect(managedAgentHostQuantity(100)).toBe(99);
    expect(managedAgentHostQuantity('nope')).toBe(1);
  });
});

describe('managedAgentHostCheckoutBlock', () => {
  it('forbids Free and unpaid tenants', () => {
    expect(managedAgentHostCheckoutBlock({ billingStatus: 'active', effectivePlan: 'free' }, null, 1)?.status).toBe(403);
    expect(managedAgentHostCheckoutBlock({ billingStatus: 'past_due', effectivePlan: 'pro' }, null, 1)?.status).toBe(403);
  });

  it('conflicts when the active entitlement already covers the requested quantity', () => {
    expect(managedAgentHostCheckoutBlock(
      { billingStatus: 'active', effectivePlan: 'pro' },
      { status: 'active', quantity: 2 },
      2,
    )?.status).toBe(409);
    expect(managedAgentHostCheckoutBlock(
      { billingStatus: 'active', effectivePlan: 'teams' },
      { status: 'active', quantity: 1 },
      2,
    )).toBeNull();
  });
});

describe('managedAgentHostRequestBlock', () => {
  it('forbids unpaid waitlist posts', () => {
    expect(managedAgentHostRequestBlock(null, 0)?.status).toBe(403);
    expect(managedAgentHostRequestBlock({ status: 'past_due', quantity: 1 }, 0)?.status).toBe(403);
  });

  it('conflicts when occupying slots equal the paid quantity', () => {
    expect(managedAgentHostRequestBlock({ status: 'active', quantity: 1 }, 1)?.status).toBe(409);
    expect(managedAgentHostRequestBlock({ status: 'active', quantity: 2 }, 1)).toBeNull();
  });
});

describe('managedAgentHostProvisionBlock', () => {
  it('requires pending → provisioning → active|failed and a same-tenant host on active', () => {
    expect(managedAgentHostProvisionBlock({
      currentStatus: 'pending', nextStatus: 'active', agentHostId: 9, hostTenantId: 7, requestTenantId: 7,
    })?.status).toBe(409);
    expect(managedAgentHostProvisionBlock({
      currentStatus: 'provisioning', nextStatus: 'active', requestTenantId: 7,
    })?.status).toBe(400);
    expect(managedAgentHostProvisionBlock({
      currentStatus: 'provisioning', nextStatus: 'active', agentHostId: 9, hostTenantId: null, requestTenantId: 7,
    })?.status).toBe(404);
    expect(managedAgentHostProvisionBlock({
      currentStatus: 'provisioning', nextStatus: 'active', agentHostId: 9, hostTenantId: 8, requestTenantId: 7,
    })?.status).toBe(409);
    expect(managedAgentHostProvisionBlock({
      currentStatus: 'provisioning', nextStatus: 'active', agentHostId: 9, hostTenantId: 7, requestTenantId: 7,
    })).toBeNull();
  });
});

describe('recordManagedAgentHostEvent', () => {
  it('is registered so webhooks do not fall through to plan activation', () => {
    expect(addonRecorderFor('managed_agent_host')).not.toBeNull();
  });

  it('upserts settings on activated with Stripe quantity', async () => {
    const db = fakeDb([[]]);
    await recordManagedAgentHostEvent(db as unknown as Db, event({ type: 'addon.activated' }));
    expect(db.calls[0]?.kind).toBe('insert');
    expect(db.calls[0]?.chain).toEqual(['values', 'onConflictDoUpdate']);
    const payload = db.calls[0]?.payload as { feature: string; value: { status: string; quantity: number } };
    expect(payload.feature).toBe('managed_agent_host');
    expect(payload.value).toMatchObject({ status: 'active', quantity: 2, orderId: 'cart-host' });
    expect(db.calls[1]?.kind).toBe('update');
  });

  it('marks past_due and cancelled and cancels still-pending requests', async () => {
    const pastDue = fakeDb([[], []]);
    await recordManagedAgentHostEvent(pastDue as unknown as Db, event({ type: 'addon.past_due' }));
    expect((pastDue.calls[0]?.payload as { value: { status: string } }).value.status).toBe('past_due');
    expect(pastDue.calls[1]?.kind).toBe('update');

    const cancelled = fakeDb([[], []]);
    await recordManagedAgentHostEvent(cancelled as unknown as Db, event({ type: 'addon.cancelled' }));
    expect((cancelled.calls[0]?.payload as { value: { status: string } }).value.status).toBe('cancelled');
    expect(cancelled.calls[1]?.kind).toBe('update');
  });
});

describe('getManagedAgentHostSubscription', () => {
  it('returns null when no settings row exists', async () => {
    const db = fakeDb([[]]);
    expect(await getManagedAgentHostSubscription(db as unknown as Db, 7)).toBeNull();
  });

  it('reads quantity from the settings value', async () => {
    const db = fakeDb([[{ value: { status: 'active', quantity: 3, orderId: 'cart-1' }, updatedAt: new Date('2026-01-01') }]]);
    await expect(getManagedAgentHostSubscription(db as unknown as Db, 7)).resolves.toMatchObject({
      status: 'active',
      quantity: 3,
      orderId: 'cart-1',
    });
  });
});

describe('occupyingManagedAgentHostCount', () => {
  it('counts occupying waitlist rows', async () => {
    const db = fakeDb([[{ id: 1 }, { id: 2 }]]);
    expect(await occupyingManagedAgentHostCount(db as unknown as Db, 7)).toBe(2);
  });
});

describe('provisionManagedAgentHostRequest', () => {
  it('sets agentHostId and provisionedAt when moving provisioning → active', async () => {
    const now = new Date('2026-02-02T00:00:00.000Z');
    const db = fakeDb([
      [{ id: 11, tenantId: 7, status: 'provisioning', agentHostId: null, provisionedAt: null }],
      [{ id: 9, tenantId: 7 }],
      [{ id: 11, tenantId: 7, status: 'active', agentHostId: 9, provisionedAt: now }],
    ]);
    const result = await provisionManagedAgentHostRequest(db as unknown as Db, {
      requestId: 11,
      status: 'active',
      agentHostId: 9,
    });
    expect(result).toMatchObject({ request: { status: 'active', agentHostId: 9 } });
    expect(db.calls[2]?.kind).toBe('update');
    expect((db.calls[2]?.payload as { agentHostId: number }).agentHostId).toBe(9);
  });
});
