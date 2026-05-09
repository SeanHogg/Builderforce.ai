/**
 * Tenant API key (bfk_*) management — shared between the owner self-service
 * flow (`tenantApiKeyRoutes.ts`) and the superadmin mint-on-behalf flow
 * (`adminRoutes.ts`). Single source of truth for raw-key generation,
 * hashing, and table layout.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenantApiKeys } from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';

export interface TenantApiKeyRow {
  id:               string;
  name:             string;
  createdByUserId:  string | null;
  lastUsedAt:       Date | null;
  revokedAt:        Date | null;
  createdAt:        Date;
}

export interface MintedTenantApiKey {
  /** Raw `bfk_*` key — only available at mint time. */
  key:        string;
  id:         string;
  name:       string;
  createdAt:  Date;
}

export interface MintTenantApiKeyInput {
  tenantId:        number;
  name:            string;
  /** User minting the key. Null for system / admin-on-behalf calls. */
  createdByUserId: string | null;
}

/** Mint a new bfk_* key for a tenant. Returns the raw key once; only the hash is stored. */
export async function mintTenantApiKey(
  db: Db,
  input: MintTenantApiKeyInput,
): Promise<MintedTenantApiKey> {
  const rawKey  = generateApiKey('bfk');
  const keyHash = await hashSecret(rawKey);

  const [row] = await db
    .insert(tenantApiKeys)
    .values({
      tenantId:        input.tenantId,
      name:            input.name,
      keyHash,
      createdByUserId: input.createdByUserId,
    })
    .returning({
      id:        tenantApiKeys.id,
      name:      tenantApiKeys.name,
      createdAt: tenantApiKeys.createdAt,
    });

  if (!row) throw new Error('Failed to mint tenant API key');
  return { key: rawKey, id: row.id, name: row.name, createdAt: row.createdAt };
}

/** List every key for a tenant, newest first. Raw key is never returned. */
export async function listTenantApiKeys(db: Db, tenantId: number): Promise<TenantApiKeyRow[]> {
  return db
    .select({
      id:               tenantApiKeys.id,
      name:             tenantApiKeys.name,
      createdByUserId:  tenantApiKeys.createdByUserId,
      lastUsedAt:       tenantApiKeys.lastUsedAt,
      revokedAt:        tenantApiKeys.revokedAt,
      createdAt:        tenantApiKeys.createdAt,
    })
    .from(tenantApiKeys)
    .where(eq(tenantApiKeys.tenantId, tenantId))
    .orderBy(desc(tenantApiKeys.createdAt));
}

/** Revoke a key. Returns true if the key existed, was for the given tenant, and was active. */
export async function revokeTenantApiKey(
  db: Db,
  args: { tenantId: number; keyId: string },
): Promise<boolean> {
  const result = await db
    .update(tenantApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(tenantApiKeys.id, args.keyId),
      eq(tenantApiKeys.tenantId, args.tenantId),
      isNull(tenantApiKeys.revokedAt),
    ))
    .returning({ id: tenantApiKeys.id });
  return result.length > 0;
}
