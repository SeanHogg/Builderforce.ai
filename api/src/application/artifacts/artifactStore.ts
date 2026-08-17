/**
 * Reading a sealed `kernel.artifacts` row — the one seal/unseal boundary every
 * consumer of a sealed file goes through, so there is exactly one place that
 * fetches R2 bytes and decrypts them.
 *
 * Writing (sealing + `env.UPLOADS.put`) currently has exactly one caller —
 * `legalDocumentStore.uploadLegalDocumentFile` — so it stays there rather than
 * being generalised here ahead of a second caller that would prove the shape.
 * Reading has two from the start (a direct download, and the signer's own file
 * review over a share token neither module owns), which is what makes it a
 * primitive rather than a duplicate.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { artifacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { credentialSecret } from '../integrations/credentialCrypto';
import { unsealBytes } from '../security/fileCrypto';

export class ArtifactNotFoundError extends Error {
  constructor(message = 'The stored file could not be found.') {
    super(message);
    this.name = 'ArtifactNotFoundError';
  }
}

export type ArtifactRow = typeof artifacts.$inferSelect;

export async function loadArtifactRow(db: Db, tenantId: number, artifactId: string): Promise<ArtifactRow | null> {
  const [row] = await db.select().from(artifacts).where(scopedToTenant(artifacts, tenantId, eq(artifacts.id, artifactId))).limit(1);
  return row ?? null;
}

export interface DecryptedArtifact {
  bytes: Uint8Array;
  mime: string | null;
  title: string;
  checksum: string | null;
}

/** Fetch a sealed artifact's bytes from R2 and decrypt them. Throws
 *  {@link ArtifactNotFoundError} rather than returning null/undefined —
 *  every caller treats a missing file as an error, never a valid empty state. */
export async function loadAndDecryptArtifact(db: Db, env: Env, tenantId: number, artifactId: string): Promise<DecryptedArtifact> {
  const row = await loadArtifactRow(db, tenantId, artifactId);
  if (!row || !row.storageKey) throw new ArtifactNotFoundError();
  if (!env.UPLOADS) throw new Error('File storage is not configured on this deployment.');
  const obj = await env.UPLOADS.get(row.storageKey);
  if (!obj) throw new ArtifactNotFoundError();
  const sealed = new Uint8Array(await obj.arrayBuffer());
  const bytes = await unsealBytes(sealed, credentialSecret(env), tenantId);
  return { bytes, mime: row.mime, title: row.title, checksum: row.checksum };
}
