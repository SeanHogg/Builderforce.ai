/**
 * Managed AgentHost add-on entitlement.
 *
 * Unit of sale is a hosted AgentHost (not a workforce Agent). Stripe quantity is
 * the host count. Entitlement lives on `settings.feature = 'managed_agent_host'`.
 *
 * On addon.cancelled / addon.past_due we cancel still-pending waitlist rows so
 * unpaid tenants cannot keep a queue. We do NOT delete an already-active linked
 * AgentHost — deprovision is out of this MVP (auto-hosting stretch).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, carts, managedAgentHostRequests, settings } from '../../infrastructure/database/schema';
import type { WebhookEvent } from '../../infrastructure/payment/PaymentProvider';

export const MANAGED_AGENT_HOST_KIND = 'managed_agent_host';
export const MANAGED_AGENT_HOST_FEATURE = 'managed_agent_host';

export type ManagedAgentHostStatus = 'active' | 'past_due' | 'cancelled';
export type ManagedAgentHostRequestStatus = 'pending' | 'provisioning' | 'active' | 'cancelled' | 'failed';

export interface ManagedAgentHostEntitlement {
  status: string;
  quantity: number;
  orderId: string | null;
  externalSubscriptionId: string | null;
  monthlyCents: number | null;
  updatedAt: Date | null;
}

const OCCUPYING: ManagedAgentHostRequestStatus[] = ['pending', 'provisioning', 'active'];

const PROVISION_NEXT: Record<string, ManagedAgentHostRequestStatus[]> = {
  pending: ['provisioning'],
  provisioning: ['active', 'failed'],
};

/** Stripe / checkout quantity. Integer 1–99; anything else is 1. */
export function managedAgentHostQuantity(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, 99);
}

export function managedAgentHostCheckoutBlock(
  tenant: { billingStatus: string; plan?: string; effectivePlan?: string },
  existing: { status: string; quantity: number } | null,
  requested: number,
): { status: 403 | 409; error: string } | null {
  const plan = tenant.effectivePlan ?? tenant.plan;
  if (tenant.billingStatus !== 'active' || plan === 'free') {
    return { status: 403, error: 'Managed AgentHost requires an active Pro or Teams plan' };
  }
  if (existing?.status === 'active' && existing.quantity >= requested) {
    return { status: 409, error: 'Managed AgentHost already covers the requested quantity' };
  }
  return null;
}

export function managedAgentHostRequestBlock(
  entitlement: { status: string; quantity: number } | null,
  occupying: number,
): { status: 403 | 409; error: string } | null {
  if (!entitlement || entitlement.status !== 'active') {
    return { status: 403, error: 'Managed AgentHost requires an active paid add-on' };
  }
  if (occupying >= entitlement.quantity) {
    return { status: 409, error: 'All paid Managed AgentHost slots are in use' };
  }
  return null;
}

export function managedAgentHostProvisionBlock(input: {
  currentStatus: string;
  nextStatus: string;
  agentHostId?: number | null;
  hostTenantId?: number | null;
  requestTenantId: number;
}): { status: 400 | 404 | 409; error: string } | null {
  if (input.nextStatus === input.currentStatus) return null;
  const allowed = PROVISION_NEXT[input.currentStatus];
  if (!allowed?.includes(input.nextStatus as ManagedAgentHostRequestStatus)) {
    return { status: 409, error: `Cannot move a '${input.currentStatus}' request to '${input.nextStatus}'` };
  }
  if (input.nextStatus === 'active') {
    if (!input.agentHostId) return { status: 400, error: 'agentHostId is required when marking a request active' };
    if (input.hostTenantId == null) return { status: 404, error: 'AgentHost not found' };
    if (input.hostTenantId !== input.requestTenantId) {
      return { status: 409, error: 'AgentHost does not belong to this tenant' };
    }
  }
  return null;
}

function statusFromEvent(event: WebhookEvent): ManagedAgentHostStatus {
  if (event.type === 'addon.activated') return 'active';
  if (event.type === 'addon.past_due') return 'past_due';
  return 'cancelled';
}

function monthlyCentsFromEvent(event: WebhookEvent): number | null {
  if (Number.isFinite(event.monthlyCents)) return event.monthlyCents!;
  const raw = Number(event.metadata?.monthlyCents);
  return Number.isFinite(raw) ? raw : null;
}

export async function recordManagedAgentHostEvent(db: Db, event: WebhookEvent): Promise<void> {
  if (event.purchaseKind !== MANAGED_AGENT_HOST_KIND || !event.tenantId) return;
  const status = statusFromEvent(event);
  const quantity = managedAgentHostQuantity(event.metadata?.quantity);
  const value = {
    status,
    quantity,
    orderId: event.cartId ?? null,
    externalSubscriptionId: event.externalSubscriptionId ?? null,
    monthlyCents: monthlyCentsFromEvent(event),
  };
  await db.insert(settings).values({
    tenantId: event.tenantId,
    scope: 'tenant',
    scopeRef: '',
    feature: MANAGED_AGENT_HOST_FEATURE,
    value,
  }).onConflictDoUpdate({
    target: [settings.tenantId, settings.scope, settings.scopeRef, settings.feature],
    set: { value, updatedAt: sql`now()` },
  });
  if (event.cartId && status === 'active') {
    await db.update(carts).set({ status: 'converted', updatedAt: sql`now()` }).where(and(eq(carts.id, event.cartId), eq(carts.tenantId, event.tenantId)));
  }
  // Cancel still-pending waitlist rows when the add-on lapses. Do NOT delete an
  // already-active linked AgentHost — deprovision is out of this MVP.
  if (status === 'cancelled' || status === 'past_due') {
    await cancelPendingManagedAgentHostRequests(db, event.tenantId);
  }
}

export async function getManagedAgentHostSubscription(db: Db, tenantId: number): Promise<ManagedAgentHostEntitlement | null> {
  const [row] = await db.select({ value: settings.value, updatedAt: settings.updatedAt }).from(settings).where(and(
    eq(settings.tenantId, tenantId),
    eq(settings.scope, 'tenant'),
    eq(settings.scopeRef, ''),
    eq(settings.feature, MANAGED_AGENT_HOST_FEATURE),
  )).limit(1);
  if (!row) return null;
  const value = row.value as {
    status?: string;
    quantity?: number;
    orderId?: string | null;
    externalSubscriptionId?: string | null;
    monthlyCents?: number | null;
  };
  return {
    status: value.status ?? 'unknown',
    quantity: managedAgentHostQuantity(value.quantity ?? 1),
    orderId: value.orderId ?? null,
    externalSubscriptionId: value.externalSubscriptionId ?? null,
    monthlyCents: value.monthlyCents ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export async function occupyingManagedAgentHostCount(db: Db, tenantId: number): Promise<number> {
  const rows = await db
    .select({ id: managedAgentHostRequests.id })
    .from(managedAgentHostRequests)
    .where(and(
      eq(managedAgentHostRequests.tenantId, tenantId),
      inArray(managedAgentHostRequests.status, OCCUPYING),
    ));
  return rows.length;
}

export async function cancelPendingManagedAgentHostRequests(db: Db, tenantId: number): Promise<void> {
  await db.update(managedAgentHostRequests)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(
      eq(managedAgentHostRequests.tenantId, tenantId),
      eq(managedAgentHostRequests.status, 'pending'),
    ));
}

export async function provisionManagedAgentHostRequest(
  db: Db,
  input: { requestId: number; status: ManagedAgentHostRequestStatus; agentHostId?: number | null },
): Promise<{ request: typeof managedAgentHostRequests.$inferSelect } | { error: { status: 400 | 404 | 409; error: string } }> {
  const [row] = await db.select().from(managedAgentHostRequests).where(eq(managedAgentHostRequests.id, input.requestId)).limit(1);
  if (!row) return { error: { status: 404, error: 'Not found' } };
  let hostTenantId: number | null | undefined;
  if (input.status === 'active' && input.agentHostId) {
    const [host] = await db.select({ id: agentHosts.id, tenantId: agentHosts.tenantId }).from(agentHosts).where(eq(agentHosts.id, input.agentHostId)).limit(1);
    hostTenantId = host?.tenantId ?? null;
  }
  const blocked = managedAgentHostProvisionBlock({
    currentStatus: row.status,
    nextStatus: input.status,
    agentHostId: input.agentHostId,
    hostTenantId,
    requestTenantId: row.tenantId,
  });
  if (blocked) return { error: blocked };
  const patch: {
    status: ManagedAgentHostRequestStatus;
    updatedAt: Date;
    provisionedAt?: Date;
    agentHostId?: number | null;
  } = { status: input.status, updatedAt: new Date() };
  if (input.status === 'active') {
    patch.provisionedAt = new Date();
    patch.agentHostId = input.agentHostId ?? null;
  }
  const [updated] = await db.update(managedAgentHostRequests).set(patch).where(eq(managedAgentHostRequests.id, input.requestId)).returning();
  if (!updated) return { error: { status: 404, error: 'Not found' } };
  return { request: updated };
}
