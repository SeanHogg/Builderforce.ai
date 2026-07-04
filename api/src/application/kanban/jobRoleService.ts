/**
 * Job-role taxonomy service — merges the canonical built-in roles (code) with a
 * tenant's custom roles (job_roles table). Cached read-through; invalidated on write.
 */
import { and, asc, eq } from 'drizzle-orm';
import { jobRoles } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { BUILTIN_ROLES, isBuiltinRoleKey } from './roleCatalog';
import type { Discipline, JobRole } from './types';

const rolesKey = (tenantId: number) => `kanban:roles:${tenantId}`;

function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

export interface JobRoleWrite {
  name: string;
  key?: string;
  description?: string;
  discipline?: Discipline;
  color?: string;
  icon?: string;
}

export class JobRoleService {
  constructor(private readonly db: Db) {}

  /** Built-ins first (canonical order), then the tenant's custom roles. */
  async list(env: Env, tenantId: number): Promise<JobRole[]> {
    const custom = await getOrSetCached(env, rolesKey(tenantId), async () => {
      const rows = await this.db
        .select()
        .from(jobRoles)
        .where(eq(jobRoles.tenantId, tenantId))
        .orderBy(asc(jobRoles.position), asc(jobRoles.name));
      return rows.map((r): JobRole => ({
        key: r.key,
        name: r.name,
        description: r.description ?? undefined,
        discipline: (r.discipline as Discipline) ?? 'engineering',
        color: r.color ?? undefined,
        icon: r.icon ?? undefined,
        builtin: false,
        position: r.position,
      }));
    });
    return [...BUILTIN_ROLES, ...custom];
  }

  async create(env: Env, tenantId: number, body: JobRoleWrite): Promise<JobRole> {
    const name = body.name?.trim();
    if (!name) throw new Error('name is required');
    const key = slugify(body.key || name);
    if (!key) throw new Error('a valid key is required');
    if (isBuiltinRoleKey(key)) throw new Error(`'${key}' is a built-in role`);

    const [existing] = await this.db
      .select({ id: jobRoles.id })
      .from(jobRoles)
      .where(and(eq(jobRoles.tenantId, tenantId), eq(jobRoles.key, key)))
      .limit(1);
    if (existing) throw new Error(`role '${key}' already exists`);

    const now = new Date();
    const id = crypto.randomUUID();
    await this.db.insert(jobRoles).values({
      id, tenantId, key, name,
      description: body.description ?? null,
      discipline: body.discipline ?? 'engineering',
      color: body.color ?? null,
      icon: body.icon ?? null,
      position: BUILTIN_ROLES.length,
      createdAt: now, updatedAt: now,
    });
    await invalidateCached(env, rolesKey(tenantId));
    return {
      key, name, description: body.description, discipline: body.discipline ?? 'engineering',
      color: body.color, icon: body.icon, builtin: false, position: BUILTIN_ROLES.length,
    };
  }

  async update(env: Env, tenantId: number, key: string, body: JobRoleWrite): Promise<void> {
    if (isBuiltinRoleKey(key)) throw new Error('built-in roles cannot be edited');
    await this.db
      .update(jobRoles)
      .set({
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.discipline ? { discipline: body.discipline } : {}),
        ...(body.color !== undefined ? { color: body.color || null } : {}),
        ...(body.icon !== undefined ? { icon: body.icon || null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(jobRoles.tenantId, tenantId), eq(jobRoles.key, key)));
    await invalidateCached(env, rolesKey(tenantId));
  }

  async remove(env: Env, tenantId: number, key: string): Promise<void> {
    if (isBuiltinRoleKey(key)) throw new Error('built-in roles cannot be deleted');
    await this.db.delete(jobRoles).where(and(eq(jobRoles.tenantId, tenantId), eq(jobRoles.key, key)));
    await invalidateCached(env, rolesKey(tenantId));
  }
}
