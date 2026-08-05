import { and, eq, getTableColumns, isNull } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { salesAssociateSettings, salesCommissionRules, salesReferrals, tenantMembers, tenants } from '../../infrastructure/database/schema';
import type { WebhookEvent } from '../../infrastructure/payment/PaymentProvider';
import { notify } from '../notifications/notify';
import { commissionCents, salesDealRevenueCents } from './salesPolicy';

/** Snapshot first-paid-conversion economics so later policy changes never rewrite earned commission. */
export async function recordReferralConversion(db: Db, env: Env, event: WebhookEvent): Promise<void> {
  if (event.type !== 'subscription.activated') return;
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.externalCustomerId, event.externalCustomerId)).limit(1);
  if (!tenant) return;
  let [referral] = event.salesReferralId
    ? await db.select({ ...getTableColumns(salesReferrals), tenantId: salesReferrals.tenantId }).from(salesReferrals).where(and(eq(salesReferrals.id, event.salesReferralId), isNull(salesReferrals.convertedAt))).limit(1)
    : [];
  if (!referral) [referral] = await db.select().from(salesReferrals).where(and(eq(salesReferrals.tenantId, tenant.id), isNull(salesReferrals.convertedAt))).limit(1);
  if (!referral) {
    // Backward-compatible fallback for an attribution created before checkout
    // binding existed: find an active owner of this workspace who was referred.
    const [owner] = await db.select({ userId: tenantMembers.userId }).from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.role, 'owner'), eq(tenantMembers.isActive, true))).limit(1);
    if (owner) [referral] = await db.select({ ...getTableColumns(salesReferrals), tenantId: salesReferrals.tenantId }).from(salesReferrals).where(and(eq(salesReferrals.referredUserId, owner.userId), isNull(salesReferrals.convertedAt))).limit(1);
  }
  if (!referral) return;
  const plan = event.targetPlan === 'teams' ? 'teams' : 'pro';
  const billingCycle = event.billingCycle === 'yearly' ? 'yearly' : 'monthly';
  const [rule] = await db.select().from(salesCommissionRules).where(eq(salesCommissionRules.ruleKey, `${plan}:${billingCycle}`)).limit(1);
  const commissionBps = referral.attributionType === 'sales' ? (rule?.salesBps ?? 0) : (rule?.referralBps ?? 0);
  const revenue = salesDealRevenueCents(plan, billingCycle, event.seats);
  const [converted] = await db.update(salesReferrals).set({ convertedAt: new Date(), tenantId: tenant.id, plan, billingCycle, revenueCents: revenue, commissionBps, commissionCents: commissionCents(revenue, commissionBps) })
    .where(and(eq(salesReferrals.id, referral.id), isNull(salesReferrals.convertedAt))).returning();
  if (!converted) return;
  const [settings] = await db.select({ enabled: salesAssociateSettings.notifyOnConversion }).from(salesAssociateSettings).where(eq(salesAssociateSettings.ownerUserId, converted.associateUserId)).limit(1);
  if (settings?.enabled !== false) await notify(db, env, { userId: converted.associateUserId, tenantId: tenant.id, kind: 'sales.referral_conversion', title: 'A referred user converted', body: `${plan.toUpperCase()} ${billingCycle} converted — $${(revenue / 100).toFixed(2)} attributed list-price revenue and $${((converted.commissionCents ?? 0) / 100).toFixed(2)} commission.`, ref: '/sales' });
}
