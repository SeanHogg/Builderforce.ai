import { and, eq } from 'drizzle-orm';
import { ValidationError } from '../../domain/shared/errors';
import type { TenantBillingCycle, TenantPlan } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import { discountCodes, discountRedemptions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

export const normalizeDiscountCode = (value: string): string => value.trim().toUpperCase();

export interface ReservedDiscount {
  redemptionId: string;
  discountId: string;
  code: string;
  percentOff: number;
  durationYears: number;
}

export async function reserveDiscount(
  db: Db,
  input: {
    tenantId: number;
    rawCode: string;
    targetPlan: TenantPlan.PRO | TenantPlan.TEAMS;
    billingCycle: TenantBillingCycle;
  },
): Promise<ReservedDiscount> {
  const code = normalizeDiscountCode(input.rawCode);
  if (!code) throw new ValidationError('Discount code is required');
  const [discount] = await db.select().from(discountCodes)
    .where(and(eq(discountCodes.code, code), eq(discountCodes.isActive, true)))
    .limit(1);
  if (!discount) throw new ValidationError('Discount code is invalid or inactive');
  if (discount.applicablePlan !== input.targetPlan || discount.billingCycle !== input.billingCycle) {
    throw new ValidationError(
      `Discount code applies only to the ${discount.billingCycle} ${discount.applicablePlan === 'pro' ? 'Individual' : 'Teams'} plan`,
    );
  }

  const redemptionId = crypto.randomUUID();
  const [reserved] = await db.insert(discountRedemptions).values({
    id: redemptionId,
    discountCodeId: discount.id,
    tenantId: input.tenantId,
  }).onConflictDoNothing({
    target: [discountRedemptions.tenantId, discountRedemptions.discountCodeId],
  }).returning({ id: discountRedemptions.id });
  if (!reserved) {
    throw new ValidationError('This discount code has already been applied to this account');
  }
  return {
    redemptionId,
    discountId: discount.id,
    code: discount.code,
    percentOff: discount.percentOff,
    durationYears: discount.durationYears,
  };
}

export async function attachDiscountCheckout(db: Db, tenantId: number, redemptionId: string, sessionId: string): Promise<void> {
  await db.update(discountRedemptions).set({ checkoutSessionId: sessionId })
    .where(scopedToTenant(discountRedemptions, tenantId, eq(discountRedemptions.id, redemptionId)));
}

export async function releaseDiscountReservation(db: Db, tenantId: number, redemptionId: string): Promise<void> {
  await db.delete(discountRedemptions).where(scopedToTenant(
    discountRedemptions,
    tenantId,
    eq(discountRedemptions.id, redemptionId),
    eq(discountRedemptions.status, 'pending'),
  ));
}

export async function markDiscountRedeemed(db: Db, tenantId: number, redemptionId: string): Promise<void> {
  await db.update(discountRedemptions)
    .set({ status: 'redeemed', redeemedAt: new Date() })
    .where(scopedToTenant(
      discountRedemptions,
      tenantId,
      eq(discountRedemptions.id, redemptionId),
      eq(discountRedemptions.status, 'pending'),
    ));
}
