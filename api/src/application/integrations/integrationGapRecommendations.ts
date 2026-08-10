import { eq, isNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { integrationCredentials } from '../../infrastructure/database/schema';
import { BOARD_PROVIDERS } from '../boardsync/providerCatalog';
import { CONNECTABLE_PROVIDERS, connectableCatalog } from './providerTests';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

export interface IntegrationCatalogCandidate {
  provider: string;
  label: string;
  category: string;
  transport: 'http' | 'tcp';
  supportsWebhook: boolean;
}

export interface ConfiguredIntegration {
  provider: string;
  projectId: number | null;
  isEnabled: boolean;
}

export interface MissingIntegrationRecommendation {
  provider: string;
  label: string;
  category: string;
  score: number;
  reason: string;
  signals: Array<'popular_default' | 'http_ready' | 'webhook_ingest'>;
  readiness: {
    httpReady: boolean;
    webhookIngest: boolean;
  };
  action: {
    label: 'Connect';
    href: string;
  };
}

const DEFAULT_PRIORITY = [
  'github', 'slack', 'jira', 'google_drive', 'gmail', 'sentry', 'linear',
  'gitlab', 'pagerduty', 'monday', 'asana', 'bitbucket',
] as const;

const CATEGORY_VALUE: Record<string, string> = {
  scm: 'Bring source-control work and delivery signals into the project.',
  pm: 'Keep project work synchronized with the team’s planning system.',
  itsm: 'Turn service-management demand into visible, trackable work.',
  incident: 'Create and update incident work from operational events.',
  data: 'Use live business data in agents and workflows.',
  marketing: 'Connect campaign execution and measurement to the work loop.',
  other: 'Use this service from Builderforce agents and workflows.',
};

function fallbackLabel(provider: string): string {
  return provider.split(/[_-]/).map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part).join(' ');
}

/** Build the recommendation catalog from the same registries used by connect/test flows. */
export function integrationRecommendationCatalog(): IntegrationCatalogCandidate[] {
  const descriptors = new Map(connectableCatalog().map((entry) => [entry.id, entry]));
  const boards = new Map(BOARD_PROVIDERS.map((entry) => [entry.id, entry]));

  return [...new Set(CONNECTABLE_PROVIDERS)].map((provider) => {
    const descriptor = descriptors.get(provider);
    const board = boards.get(provider);
    return {
      provider,
      label: board?.label ?? descriptor?.label ?? fallbackLabel(provider),
      category: board?.category ?? descriptor?.family ?? 'other',
      transport: descriptor?.transport ?? 'http',
      supportsWebhook: board?.supportsWebhook ?? false,
    };
  });
}

/**
 * Pure decision function used by the API and available to onboarding/manager
 * surfaces. It excludes enabled global/project connections and returns a stable,
 * bounded ranking when no personalization data exists.
 */
export function deriveMissingIntegrationRecommendations(
  catalog: IntegrationCatalogCandidate[],
  configured: ConfiguredIntegration[],
  projectId?: number,
  limit = 10,
): MissingIntegrationRecommendation[] {
  const connected = new Set(
    configured
      .filter((entry) => entry.isEnabled && (projectId == null || entry.projectId == null || entry.projectId === projectId))
      .map((entry) => entry.provider),
  );
  const priority = new Map<string, number>(
    DEFAULT_PRIORITY.map((provider, index) => [provider, DEFAULT_PRIORITY.length - index]),
  );

  return catalog
    .filter((entry) => !connected.has(entry.provider))
    .map((entry) => {
      const signals: MissingIntegrationRecommendation['signals'] = [];
      const popularity = priority.get(entry.provider) ?? 0;
      if (popularity > 0) signals.push('popular_default');
      if (entry.transport === 'http') signals.push('http_ready');
      if (entry.supportsWebhook) signals.push('webhook_ingest');
      return {
        provider: entry.provider,
        label: entry.label,
        category: entry.category,
        score: popularity * 10 + (entry.supportsWebhook ? 5 : 0) + (entry.transport === 'http' ? 2 : 0),
        reason: CATEGORY_VALUE[entry.category] ?? CATEGORY_VALUE.other!,
        signals,
        readiness: {
          httpReady: entry.transport === 'http',
          webhookIngest: entry.supportsWebhook,
        },
        action: {
          label: 'Connect' as const,
          href: `/settings/integrations?provider=${encodeURIComponent(entry.provider)}`,
        },
      };
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, Math.min(limit, 10)));
}

export async function getMissingIntegrationRecommendations(
  db: Db,
  tenantId: number,
  projectId?: number,
): Promise<MissingIntegrationRecommendation[]> {
  const configured = await db
    .select({
      provider: integrationCredentials.provider,
      projectId: integrationCredentials.projectId,
      isEnabled: integrationCredentials.isEnabled,
    })
    .from(integrationCredentials)
    .where(scopedToTenant(
      integrationCredentials,
      tenantId,
      projectId == null ? undefined : or(isNull(integrationCredentials.projectId), eq(integrationCredentials.projectId, projectId)),
    ));

  return deriveMissingIntegrationRecommendations(integrationRecommendationCatalog(), configured, projectId);
}
