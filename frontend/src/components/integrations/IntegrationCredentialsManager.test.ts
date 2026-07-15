import { describe, expect, it } from 'vitest';
import { filterCredentialsByProvider } from './IntegrationCredentialsManager';
import type { IntegrationCredential } from '@/lib/builderforceApi';

const credential = (id: string, provider: IntegrationCredential['provider']): IntegrationCredential => ({
  id,
  provider,
  projectId: null,
  name: `${provider} key`,
  baseUrl: null,
  isEnabled: true,
  createdAt: '2026-07-01T00:00:00.000Z',
});

describe('filterCredentialsByProvider', () => {
  it('does not show a GitHub credential in the Jira drawer', () => {
    const rows = [credential('github-key', 'github'), credential('jira-key', 'jira')];
    expect(filterCredentialsByProvider(rows, 'jira')).toEqual([rows[1]]);
  });

  it('supports multi-provider contexts', () => {
    const rows = [credential('github-key', 'github'), credential('jira-key', 'jira')];
    expect(filterCredentialsByProvider(rows, 'github|jira')).toEqual(rows);
  });
});
