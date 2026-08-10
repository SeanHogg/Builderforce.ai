import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { businessPhoneNumbers, carts, catalogItems, orderLineItems, orders, settings } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { WebhookEvent } from '../../infrastructure/payment/PaymentProvider';

export async function recordBusinessPhoneEvent(db: Db, event: WebhookEvent): Promise<void> {
  if (event.purchaseKind !== 'business_phone' || !event.tenantId) return;
  const status = event.type === 'addon.activated' ? 'active' : event.type === 'addon.past_due' ? 'past_due' : 'cancelled';
  const activationCents = Number.isFinite(event.activationCents) ? event.activationCents! : 1995;
  const monthlyCents = Number.isFinite(event.monthlyCents) ? event.monthlyCents! : 995;
  const [existing] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, event.tenantId), eq(orders.provider, 'stripe_business_phone'), eq(orders.providerRef, event.externalSubscriptionId))).limit(1);
  let orderId = existing?.id;
  if (!orderId && status === 'active') {
    const catalogItemId = 'f10e0000-0000-4000-8000-000000000001';
    await db.insert(catalogItems).values({ id: catalogItemId, kind: 'offering', slug: 'business-phone', name: 'BuilderForce Business Phone', summary: 'Dedicated business voice, SMS, and MMS service', body: { activationCents, monthlyCents }, category: 'communications', visibility: 'public', priceCents: monthlyCents, currency: 'USD', publishedAt: new Date() }).onConflictDoUpdate({ target: catalogItems.id, set: { body: { activationCents, monthlyCents }, priceCents: monthlyCents, updatedAt: sql`now()` } });
    const [created] = await db.insert(orders).values({ tenantId: event.tenantId, orderNumber: `PHONE-${event.externalSubscriptionId.slice(-32)}`, buyerEmail: event.billingEmail, currency: 'USD', subtotalCents: activationCents + monthlyCents, totalCents: activationCents + monthlyCents, status: 'paid', provider: 'stripe_business_phone', providerRef: event.externalSubscriptionId }).returning({ id: orders.id });
    if (!created) throw new Error('Business Phone order was not created');
    orderId = created.id;
    await db.insert(orderLineItems).values([
      { tenantId: event.tenantId, orderId, catalogItemId, description: 'Business Phone activation', unitCents: activationCents, amountCents: activationCents, position: 0 },
      { tenantId: event.tenantId, orderId, catalogItemId, description: 'Business Phone monthly service', unitCents: monthlyCents, amountCents: monthlyCents, position: 1 },
    ]);
    if (event.cartId) await db.update(carts).set({ status: 'converted', convertedOrderId: orderId, updatedAt: sql`now()` }).where(and(eq(carts.id, event.cartId), eq(carts.tenantId, event.tenantId)));
  } else if (orderId) {
    await db.update(orders).set({ status: status === 'active' ? 'paid' : status === 'cancelled' ? 'cancelled' : 'pending', updatedAt: sql`now()` }).where(scopedToTenant(orders, event.tenantId, eq(orders.id, orderId)));
  }
  await db.insert(settings).values({ tenantId: event.tenantId, scope: 'tenant', scopeRef: '', feature: 'business_phone', value: { status, orderId, externalSubscriptionId: event.externalSubscriptionId } }).onConflictDoUpdate({ target: [settings.tenantId, settings.scope, settings.scopeRef, settings.feature], set: { value: { status, orderId, externalSubscriptionId: event.externalSubscriptionId }, updatedAt: sql`now()` } });
}

export async function getBusinessPhoneSubscription(db: Db, tenantId: number) {
  const [entitlement] = await db.select({ value: settings.value, updatedAt: settings.updatedAt }).from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.scope, 'tenant'), eq(settings.scopeRef, ''), eq(settings.feature, 'business_phone'))).limit(1);
  if (!entitlement) return null;
  const [number] = await db.select({ e164: businessPhoneNumbers.e164, status: businessPhoneNumbers.status }).from(businessPhoneNumbers).where(eq(businessPhoneNumbers.tenantId, tenantId)).limit(1);
  const value = entitlement.value as { status?: string; orderId?: number; externalSubscriptionId?: string };
  return { status: value.status ?? 'unknown', orderId: value.orderId, externalSubscriptionId: value.externalSubscriptionId, updatedAt: entitlement.updatedAt, number: number ?? null };
}
