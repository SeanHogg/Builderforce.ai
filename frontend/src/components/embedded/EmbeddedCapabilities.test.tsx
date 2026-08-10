import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  tenant: { id: '42', role: 'owner' },
  tenantToken: null as string | null,
}));
const api = vi.hoisted(() => ({ getConfig: vi.fn(), setFeature: vi.fn() }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/builderforceApi', () => ({ embedApi: api }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/components/settings/EmbedIntegrationSettings', () => ({ EmbedIntegrationSettings: () => null }));
vi.mock('@/components/SlideOutPanel', () => ({ SlideOutPanel: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import { EmbeddedCapabilities } from './EmbeddedCapabilities';

const featureKeys = [
  'usage_tracking', 'support_widget', 'feedback_widget', 'heatmaps', 'feature_management',
  'terms_gate', 'sourcing', 'lead_forms', 'push_notifications', 'onboarding',
  'cookie_consent', 'hr_widget', 'status_page',
] as const;

const config = {
  enabled: false,
  capabilities: [],
  isolationMode: 'single',
  consentVersion: null,
  consentedAt: null,
  consentedBy: null,
  consentRequiredVersion: 1,
  customerFeatures: Object.fromEntries(featureKeys.map((key) => [key, {
    enabled: false, consentVersion: null, consentedAt: null, consentedBy: null,
  }])),
  customerConsentLog: [],
  customerFeatureKeys: [...featureKeys],
  customerConsentRequiredVersion: 1,
  publicKey: 'bf_42',
};

describe('EmbeddedCapabilities authentication boundary', () => {
  beforeEach(() => {
    auth.tenantToken = null;
    api.getConfig.mockReset();
    api.getConfig.mockResolvedValue(config);
  });

  it('waits for a workspace JWT before requesting tenant-scoped embed config', async () => {
    const view = render(<EmbeddedCapabilities />);
    expect(api.getConfig).not.toHaveBeenCalled();

    auth.tenantToken = 'tenant-jwt';
    view.rerender(<EmbeddedCapabilities />);

    await waitFor(() => expect(api.getConfig).toHaveBeenCalledTimes(1));
  });
});
