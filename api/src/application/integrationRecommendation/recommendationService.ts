import { and, eq, sql } from 'drizzle-orm';
import { integrationCredentials, integrationProviders } from '../../infrastructure/database/schema';
import { providerCatalog } from '../../application/boardsync/providerCatalog';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Get all available integrations from the catalog
 */
export async function getAvailableIntegrations(db: Db) {
  return providerCatalog;
}

/**
 * Get all integrations currently connected to a workspace
 */
export async function getConnectedIntegrations(db: Db, tenantId: number) {
  const results = await db
    .select({
      provider: integrationCredentials.provider,
      name: integrationCredentials.name,
      id: integrationCredentials.id,
      isEnabled: integrationCredentials.is_enabled
    })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.tenantId, tenantId));

  return results;
}

/**
 * Find integration gaps for a workspace
 */
export async function findIntegrationGaps(db: Db, tenantId: number) {
  const available = await getAvailableIntegrations(db);
  const connected = await getConnectedIntegrations(db, tenantId);

  // Create a set of connected providers for quick lookup
  const connectedProviders = new Set(connected.map(c => c.provider));

  // Find providers in catalog but not in connected integrations
  return available.filter(provider => !connectedProviders.has(provider.id));
}

/**
 * Generate recommendation scores based on usage patterns
 */
export function scoreRecommendations(available, connected) {
  // This would be implemented with actual scoring logic
  // For now, return a simple popularity-based score
  return available.map(provider => ({
    ...provider,
    score: 100 - (connected.length / available.length) * 100
  }));
}

/**
 * Get recommended integrations for a workspace
 */
export async function getRecommendations(db: Db, tenantId: number) {
  const available = await getAvailableIntegrations(db);
  const connected = await getConnectedIntegrations(db, tenantId);

  // For demo, return all available integrations as recommendations
  // In production, this would use the scoring system
  return available;
}
