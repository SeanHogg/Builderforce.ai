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
    const rows = await this.sql({ NEON_DATABASE_URL: '' })
      `INSERT INTO capabilities (id, tenant_id, title, description, category, status, priority, tags, created_by_user_id)
       VALUES (${id}, ${tenantId}, ${title}, ${description}, ${category}, ${status}, ${priority}, ${tags || null}, ${created_by_user_id || null})
       RETURNING *`;

    return this.mapRow(rows[0]);
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
      fields.push('title = ' + String(dto.title));
    }
    if (dto.description !== undefined) {
      fields.push('description = ' + String(dto.description ?? null));
    }
    if (dto.category !== undefined) {
      fields.push('category = ' + String(dto.category ?? null));
    }
    if (dto.status !== undefined) {
      fields.push('status = ' + String(dto.status));
    }
    if (dto.priority !== undefined) {
      fields.push('priority = ' + String(dto.priority ?? null));
    }
    if (dto.tags !== undefined) {
      fields.push('tags = ' + String(dto.tags ?? null));
    }

    if (fields.length === 0) return this.getById(id); // Nothing to update

    const rows = await this.sql({ NEON_DATABASE_URL: '' })
      `UPDATE capabilities SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ${id} RETURNING *`;

    return (rows.length > 0 ? this.mapRow(rows[0]) : null);
  }

  async delete(id: Id): Promise<boolean> {
    const result = await this.sql({ NEON_DATABASE_URL: '' })
      `DELETE FROM capabilities WHERE id = ${id}`;
    return (result.changes ?? 0) > 0;
  }

  async list(params: CapabilityListParams): Promise<Capability[]> {
    const { tenantId, status, category, limit = 100, offset = 0 } = params;

    let where = 'tenant_id = ' + String(tenantId);
    const values: unknown[] = [tenantId];

    if (status) {
      where += ' AND status = $' + String(values.length + 1);
      values.push(status);
    }
    if (category) {
      where += ' AND category = $' + String(values.length + 1);
      values.push(category);
    }

    const rows = await this.sql({ NEON_DATABASE_URL: '' })
      `SELECT * FROM capabilities WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

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