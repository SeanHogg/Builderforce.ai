import { describe, expect, it } from 'vitest';
import { deriveMissingIntegrationRecommendations, type IntegrationCatalogCandidate } from './integrationGapRecommendations';

const catalog: IntegrationCatalogCandidate[] = [
  { provider: 'github', label: 'GitHub', category: 'scm', transport: 'http', supportsWebhook: true },
  { provider: 'jira', label: 'Jira', category: 'pm', transport: 'http', supportsWebhook: true },
  { provider: 'postgres', label: 'Postgres', category: 'data', transport: 'tcp', supportsWebhook: false },
];

describe('deriveMissingIntegrationRecommendations', () => {
  it('excludes active global and matching project integrations', () => {
    const result = deriveMissingIntegrationRecommendations(catalog, [
      { provider: 'github', projectId: null, isEnabled: true },
      { provider: 'jira', projectId: 7, isEnabled: true },
    ], 7);

    expect(result.map((entry) => entry.provider)).toEqual(['postgres']);
  });

  it('does not let another project hide a recommendation', () => {
    const result = deriveMissingIntegrationRecommendations(catalog, [
      { provider: 'github', projectId: 8, isEnabled: true },
    ], 7);

    expect(result[0]).toMatchObject({
      provider: 'github',
      signals: ['popular_default', 'http_ready', 'webhook_ingest'],
      readiness: { httpReady: true, webhookIngest: true },
      action: { label: 'Connect', href: '/settings/integrations?provider=github' },
    });
  });

  it('treats disabled credentials as gaps and caps the fallback list at ten', () => {
    const expanded = Array.from({ length: 15 }, (_, index): IntegrationCatalogCandidate => ({
      provider: `custom_${index}`,
      label: `Custom ${index}`,
      category: 'other',
      transport: 'http',
      supportsWebhook: false,
    }));
    const result = deriveMissingIntegrationRecommendations(expanded, [
      { provider: 'custom_0', projectId: null, isEnabled: false },
    ]);

    expect(result).toHaveLength(10);
    expect(result.some((entry) => entry.provider === 'custom_0')).toBe(true);
  });
});
