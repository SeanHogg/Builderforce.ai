import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { ITenantRepository } from '../../domain/tenant/ITenantRepository';
import { Tenant, TenantMemberProps } from '../../domain/tenant/Tenant';
import {
  TenantId,
  TenantStatus,
  TenantRole,
  TenantPlan,
  TenantBillingCycle,
  TenantBillingStatus,
  asTenantId,
} from '../../domain/shared/types';
import { asSeatKind } from '../../domain/tenant/SeatKind';
import { tenants as tenantsTable, tenantMembers as membersTable, segments as segmentsTable } from '../database/schema';
import type { Db } from '../database/connection';

export class TenantRepository implements ITenantRepository {
  constructor(private readonly db: Db) {}

  async findAll(): Promise<Tenant[]> {
    const rows = await this.db.select().from(tenantsTable);
    return Promise.all(rows.map(r => this.hydrateMembers(r)));
  }

  async findById(id: TenantId): Promise<Tenant | null> {
    const [row] = await this.db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, id))
      .limit(1);
    return row ? this.hydrateMembers(row) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const [row] = await this.db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, slug))
      .limit(1);
    return row ? this.hydrateMembers(row) : null;
  }

  async findByExternalCustomerId(externalCustomerId: string): Promise<Tenant | null> {
    const [row] = await this.db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.externalCustomerId, externalCustomerId))
      .limit(1);
    return row ? this.hydrateMembers(row) : null;
  }

  async findByUserId(userId: string): Promise<Tenant[]> {
    const memberRows = await this.db
      .select({ tenantId: membersTable.tenantId })
      .from(membersTable)
      .where(eq(membersTable.userId, userId));
    if (!memberRows.length) return [];
    const tenantIds = memberRows.map(r => r.tenantId);
    const rows = await this.db
      .select()
      .from(tenantsTable)
      .where(inArray(tenantsTable.id, tenantIds));
    return Promise.all(rows.map(r => this.hydrateMembers(r)));
  }

  async save(tenant: Tenant): Promise<Tenant> {
    const plain = tenant.toPlain();
    const [inserted] = await this.db
      .insert(tenantsTable)
      .values({
        name: plain.name,
        slug: plain.slug,
        status: plain.status,
        defaultAgentHostId: plain.defaultAgentHostId,
        plan: plain.plan,
        billingCycle: plain.billingCycle,
        billingStatus: plain.billingStatus,
        billingEmail: plain.billingEmail,
        billingPaymentBrand: plain.billingPaymentBrand,
        billingPaymentLast4: plain.billingPaymentLast4,
        billingUpdatedAt: plain.billingUpdatedAt,
        externalCustomerId: plain.externalCustomerId,
        externalSubscriptionId: plain.externalSubscriptionId,
        seatCount: plain.seatCount,
        trialEndsAt: plain.trialEndsAt,
      })
      .returning();
    if (!inserted) throw new Error('Insert returned no rows');

    // Mint the tenant's default segment. Design invariant (migration 0054):
    // EVERY tenant always has >= 1 segment, so segment_id can be NOT NULL on
    // every business entity and resolveSegment() never faults. The 0054 backfill
    // only covered tenants that existed at migration time; new tenants must mint
    // it here, or every request's resolveDefault() throws "No default segment".
    // Mirrors the backfill shape (slug 'default', plan from tenant, is_default).
    // onConflictDoNothing keeps it idempotent against the partial unique index
    // uq_segments_one_default_per_tenant.
    await this.db
      .insert(segmentsTable)
      .values({
        tenantId:    inserted.id,
        displayName: plain.name,
        slug:        'default',
        plan:        plain.plan,
        isDefault:   true,
      })
      .onConflictDoNothing();

    // Persist initial members
    if (plain.members.length > 0) {
      await this.db.insert(membersTable).values(
        plain.members.map(m => ({
          tenantId: inserted.id,
          userId:   m.userId,
          role:     m.role,
          isActive: m.isActive,
          joinedAt: m.joinedAt,
          seatKind: m.seatKind,
        })),
      );
    }

    const saved = await this.findById(asTenantId(inserted.id));
    return saved!;
  }

  async update(tenant: Tenant): Promise<Tenant> {
    const plain = tenant.toPlain();
    await this.db
      .update(tenantsTable)
      .set({
        name: plain.name,
        status: plain.status,
        defaultAgentHostId: plain.defaultAgentHostId,
        plan: plain.plan,
        billingCycle: plain.billingCycle,
        billingStatus: plain.billingStatus,
        billingEmail: plain.billingEmail,
        billingPaymentBrand: plain.billingPaymentBrand,
        billingPaymentLast4: plain.billingPaymentLast4,
        billingUpdatedAt: plain.billingUpdatedAt,
        externalCustomerId: plain.externalCustomerId,
        externalSubscriptionId: plain.externalSubscriptionId,
        seatCount: plain.seatCount,
        trialEndsAt: plain.trialEndsAt,
        updatedAt: plain.updatedAt,
      })
      .where(eq(tenantsTable.id, plain.id));

    // UPSERT the roster, never "delete every row and re-insert it".
    //
    // The old shape lost data on every single membership write: `tenant_members`
    // carries per-seat state the aggregate does not model — the monthly spend cap
    // and its notify bookkeeping (migration 0359) — and deleting the row threw all
    // of it away, so adding one person silently reset everybody's spend limits.
    // A membership is now identified by (tenant_id, user_id), unique since
    // migration 1138, and only the four columns the aggregate actually owns are
    // written.
    if (plain.members.length > 0) {
      await this.db
        .insert(membersTable)
        .values(
          plain.members.map(m => ({
            tenantId: plain.id,
            userId:   m.userId,
            role:     m.role,
            isActive: m.isActive,
            joinedAt: m.joinedAt,
            seatKind: m.seatKind,
          })),
        )
        .onConflictDoUpdate({
          target: [membersTable.tenantId, membersTable.userId],
          set: {
            role:     sql`excluded.role`,
            isActive: sql`excluded.is_active`,
            seatKind: sql`excluded.seat_kind`,
          },
        });
    }
    // A member the aggregate no longer carries at all was dropped by something
    // other than `removeMember` (which deactivates in place). Deactivate rather
    // than delete, so the audit trail and the spend history survive.
    const kept = plain.members.map(m => m.userId);
    await this.db
      .update(membersTable)
      .set({ isActive: false })
      .where(and(
        eq(membersTable.tenantId, plain.id),
        kept.length > 0 ? notInArray(membersTable.userId, kept) : undefined,
      ));

    const updated = await this.findById(plain.id);
    return updated!;
  }

  async delete(id: TenantId): Promise<void> {
    await this.db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async hydrateMembers(
    row: typeof tenantsTable.$inferSelect,
  ): Promise<Tenant> {
    const memberRows = await this.db
      .select()
      .from(membersTable)
      .where(eq(membersTable.tenantId, row.id));

    const members: TenantMemberProps[] = memberRows.map(m => ({
      userId:   m.userId,
      role:     m.role as TenantRole,
      isActive: m.isActive,
      joinedAt: m.joinedAt,
      seatKind: asSeatKind(m.seatKind),
    }));

    return Tenant.reconstitute({
      id:        asTenantId(row.id),
      name:      row.name,
      slug:      row.slug,
      status:    row.status as TenantStatus,
      defaultAgentHostId: row.defaultAgentHostId,
      plan:      row.plan as TenantPlan,
      billingCycle: row.billingCycle as TenantBillingCycle | null,
      billingStatus: row.billingStatus as TenantBillingStatus,
      billingEmail: row.billingEmail,
      billingPaymentBrand: row.billingPaymentBrand,
      billingPaymentLast4: row.billingPaymentLast4,
      billingUpdatedAt: row.billingUpdatedAt,
      externalCustomerId: row.externalCustomerId ?? null,
      externalSubscriptionId: row.externalSubscriptionId ?? null,
      seatCount: row.seatCount ?? null,
      trialEndsAt: row.trialEndsAt ?? null,
      members,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
