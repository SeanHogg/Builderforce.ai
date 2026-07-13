/**
 * Repository for capability CRUD operations.
 */

import { neon } from '@neondatabase/serverless';
import type {
  Capability,
  CreateCapabilityDTO,
  UpdateCapabilityDTO,
  CapabilityListParams,
  Id,
} from '../../domain/capability/ICapabilityRepository';

export class CapabilityRepository {
  constructor(private readonly sql: (env: { NEON_DATABASE_URL: string }) => ReturnType<typeof neon>) {}

  async create(dto: CreateCapabilityDTO): Promise<Capability> {
    const {
      title,
      description,
      category,
      status,
      priority,
      tags,
      tenantId,
      created_by_user_id,
    } = dto;

    const id = crypto.randomUUID();
    await this.sql({ NEON_DATABASE_URL: '' })
      `INSERT INTO capabilities (id, tenant_id, title, description, category, status, priority, tags, created_by_user_id)
        VALUES (${id}, ${tenantId}, ${title}, ${description}, ${category}, ${status}, ${priority}, ${tags || null}, ${created_by_user_id || null})`;

    return this.getById(id);
  }

  async getById(id: Id): Promise<Capability | null> {
    const rows = await this.sql({ NEON_DATABASE_URL: '' })
      `SELECT * FROM capabilities WHERE id = ${id}`;
    return (rows.length > 0 ? this.mapRow(rows[0]) : null);
  }

  async update(id: Id, dto: UpdateCapabilityDTO): Promise<Capability | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (dto.title !== undefined) {
      fields.push('title');
      values.push(dto.title);
    }
    if (dto.description !== undefined) {
      fields.push('description');
      values.push(dto.description ?? null);
    }
    if (dto.category !== undefined) {
      fields.push('category');
      values.push(dto.category ?? null);
    }
    if (dto.status !== undefined) {
      fields.push('status');
      values.push(dto.status);
    }
    if (dto.priority !== undefined) {
      fields.push('priority');
      values.push(dto.priority ?? null);
    }
    if (dto.tags !== undefined) {
      fields.push('tags');
      values.push(dto.tags ?? null);
    }

    if (fields.length === 0) return this.getById(id); // Nothing to update

    values.push(id);
    const sql = this.sql({ NEON_DATABASE_URL: '' })
      `UPDATE capabilities SET ${fields.map((f) => `${f} = $${fields.indexOf(f) + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${fields.length + 1} RETURNING *`;

    const rows = await sql(...values.map(v => SQL` ${v}`));
    return (rows.length > 0 ? this.mapRow(rows[0]) : null);
  }

  async delete(id: Id): Promise<boolean> {
    const result = await this.sql({ NEON_DATABASE_URL: '' })
      `DELETE FROM capabilities WHERE id = ${id}`;
    return result.count !== null && result.count > 0;
  }

  async list(params: CapabilityListParams): Promise<Capability[]> {
    const { tenantId, status, category, limit = 100, offset = 0 } = params;

    const conditions: string[] = [`tenant_id = ${tenantId}`];
    const valueCount = 1;

    if (status) {
      conditions.push(`status = $${valueCount + conditions.length}`);
    }
    if (category) {
      conditions.push(`category = $${valueCount + conditions.length}`);
    }

    const where = conditions.join(' AND ');
    const sql = this.sql({ NEON_DATABASE_URL: '' })
      `SELECT * FROM capabilities WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const binds: unknown[] = [tenantId];
    if (status) binds.push(status);
    if (category) binds.push(category);

    const rows = await sql(...binds);
    return rows.map((row) => this.mapRow(row));
  }

  async count(tenantId: string): Promise<number> {
    const result = await this.sql({ NEON_DATABASE_URL: '' })
      `SELECT COUNT(*) as count FROM capabilities WHERE tenant_id = ${tenantId}`;
    return Number(result[0]?.count ?? 0);
  }

  private mapRow(row: Record<string, unknown>): Capability {
    return {
      id: row.id as string,
      tenant_id: String(row.tenant_id),
      title: String(row.title),
      description: row.description as string | null,
      category: row.category as string | null,
      status: row.status as Capability['status'],
      priority: row.priority as string | null,
      tags: Array.isArray(row.tags) ? (row.tags as unknown[]) : null,
      created_by_user_id: row.created_by_user_id as string | null,
      created_at: row.created_at as string | null,
      updated_at: row.updated_at as string | null,
    };
  }
}