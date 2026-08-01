/**
 * Resolve a tenant's connected Google integration (Gmail / Drive) credential
 * blob from the shared per-tenant vault (`integration_credentials`) — the SAME
 * store github/jira/sentry/brave_search use. Returns the decrypted OAuth offline
 * credentials, or null when nothing usable is connected. Never throws: a DB or
 * decrypt hiccup degrades to "not connected".
 */

import { and, eq } from 'drizzle-orm';
import { integrationCredentials } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { decryptCredentials } from './credentialCrypto';
import type { GoogleOAuthCreds } from './googleOAuth';

export type GoogleProvider = 'gmail' | 'google_drive';

export async function loadGoogleCredential(
  env: Env,
  db: Db,
  tenantId: number,
  provider: GoogleProvider,
): Promise<GoogleOAuthCreds | null> {
  try {
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
    if (!secret) return null;
    const [row] = await db
      .select({ credentialsEnc: integrationCredentials.credentialsEnc, iv: integrationCredentials.iv })
      .from(integrationCredentials)
      .where(and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, provider),
        eq(integrationCredentials.isEnabled, true),
      ))
      .limit(1);
    if (!row) return null;
    const creds = await decryptCredentials(row.credentialsEnc, row.iv, secret, tenantId);
    return (creds as GoogleOAuthCreds) ?? null;
  } catch {
    return null;
  }
}
