import { and, eq } from 'drizzle-orm';
import { IClawRepository } from '../../domain/claw/IClawRepository';
import { Claw, ClawStatus } from '../../domain/claw/Claw';
import { asClawId, asTenantId, ClawId, TenantId } from '../../domain/shared/types';
import { coderclawInstances } from '../database/schema';
import type { Db } from '../database/connection';
import { verifySecret } from '../auth/HashService';

export class ClawRepository implements IClawRepository {
  constructor(private readonly db: Db) {}

  async findById(id: ClawId): Promise<Claw | null> {
    const [row] = await (this.db
      .select()
      .from(coderclawInstances) as any)
      .where(eq(coderclawInstances.id, id))
      .limit(1);
    return row ? this.toDomain(row) : null;
  }

  async findByIdAndTenant(id: ClawId, tenantId: TenantId): Promise<Claw | null> {
    const [row] = await (this.db
      .select()
      .from(coderclawInstances) as any)
      .where(and(eq(coderclawInstances.id, id), eq(coderclawInstances.tenantId, tenantId)))
      .limit(1);
    return row ? this.toDomain(row) : null;
  }

  async findByTenant(tenantId: TenantId): Promise<Claw[]> {
    const rows = await (this.db
      .select()
      .from(coderclawInstances) as any)
      .where(eq(coderclawInstances.tenantId, tenantId));
    return rows.map((r: unknown) => this.toDomain(r));
  }

  async verifyApiKey(id: ClawId, apiKey: string): Promise<Claw | null> {
    const [row] = await this.db
      .select()
      .from(coderclawInstances)
      .where(eq(coderclawInstances.id, id))
      .limit(1);
    if (!row) return null;
    const valid = await verifySecret(apiKey, row.apiKeyHash ?? '');
    return valid ? this.toDomain(row) : null;
  }

  async updateStatus(id: ClawId, tenantId: TenantId, status: ClawStatus): Promise<Claw | null> {
    const [row] = await this.db
      .update(coderclawInstances)
      .set({
        status,
      })
      .where(and(eq(coderclawInstances.id, id), eq(coderclawInstances.tenantId, tenantId)))
      .returning();
    return row ? this.toDomain(row) : null;
  }

  private toDomain(row: any): Claw {
    return Claw.reconstitute({
      id: asClawId(row.id),
      tenantId: asTenantId(row.tenantId),
      name: row.name,
      slug: row.slug,
      status: row.status,
      apiKeyHash: row.apiKeyHash ?? null,
      capabilities: row.capabilities ? (JSON.parse(row.capabilities) as string[]) : null,
      declaredCapabilities: row.declaredCapabilities ? (JSON.parse(row.declaredCapabilities) as string[]) : null,
      connectedAt: row.connectedAt ?? null,
      lastSeenAt: row.lastSeenAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
