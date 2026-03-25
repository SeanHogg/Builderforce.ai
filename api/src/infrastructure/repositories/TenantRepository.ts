import { eq, inArray } from 'drizzle-orm';
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
import { tenants as tenantsTable, tenantMembers as membersTable } from '../database/schema';
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
        defaultClawId: plain.defaultClawId,
        plan: plain.plan,
        billingCycle: plain.billingCycle,
        billingStatus: plain.billingStatus,
        billingEmail: plain.billingEmail,
        billingPaymentBrand: plain.billingPaymentBrand,
        billingPaymentLast4: plain.billingPaymentLast4,
        billingUpdatedAt: plain.billingUpdatedAt,
        externalCustomerId: plain.externalCustomerId,
        externalSubscriptionId: plain.externalSubscriptionId,
      })
      .returning();
    if (!inserted) throw new Error('Insert returned no rows');

    // Persist initial members
    if (plain.members.length > 0) {
      await this.db.insert(membersTable).values(
        plain.members.map(m => ({
          tenantId: inserted.id,
          userId:   m.userId,
          role:     m.role,
          isActive: m.isActive,
          joinedAt: m.joinedAt,
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
        defaultClawId: plain.defaultClawId,
        plan: plain.plan,
        billingCycle: plain.billingCycle,
        billingStatus: plain.billingStatus,
        billingEmail: plain.billingEmail,
        billingPaymentBrand: plain.billingPaymentBrand,
        billingPaymentLast4: plain.billingPaymentLast4,
        billingUpdatedAt: plain.billingUpdatedAt,
        externalCustomerId: plain.externalCustomerId,
        externalSubscriptionId: plain.externalSubscriptionId,
        updatedAt: plain.updatedAt,
      })
      .where(eq(tenantsTable.id, plain.id));

    // Replace members: delete all then re-insert
    await this.db.delete(membersTable).where(eq(membersTable.tenantId, plain.id));
    if (plain.members.length > 0) {
      await this.db.insert(membersTable).values(
        plain.members.map(m => ({
          tenantId: plain.id,
          userId:   m.userId,
          role:     m.role,
          isActive: m.isActive,
          joinedAt: m.joinedAt,
        })),
      );
    }

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
    }));

    return Tenant.reconstitute({
      id:        asTenantId(row.id),
      name:      row.name,
      slug:      row.slug,
      status:    row.status as TenantStatus,
      defaultClawId: row.defaultClawId,
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
      members,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
