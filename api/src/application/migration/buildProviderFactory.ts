/**
 * Shared provider-factory builder for migration flows. Loads + decrypts a
 * tenant's integration credential and returns a `ProviderForBoard` that builds a
 * boardsync provider scoped to any external board (null = account-wide discover).
 *
 * Used by BOTH the HTTP routes (migrationRoutes) and the Brain/MCP tools
 * (builtinMcpService) so the credential-load + provider-build path lives once.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { loadConnectionCredentials } from '../boardsync/drizzleStore';
import { createBoardProvider } from '../boardsync/providers';
import type { ProviderForBoard } from './MigrationService';

export async function buildMigrationProviderFactory(
  db: Db,
  env: Env,
  tenantId: number,
  provider: string,
  credentialId: string | null,
): Promise<ProviderForBoard | null> {
  const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
  const loaded = await loadConnectionCredentials(db, tenantId, credentialId, secret);
  if (!loaded) return null;
  return (externalBoardId) =>
    createBoardProvider(provider, { credentials: loaded.credentials, baseUrl: loaded.baseUrl, externalBoardId }, fetch);
}
