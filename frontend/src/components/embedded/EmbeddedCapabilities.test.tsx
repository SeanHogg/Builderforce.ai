import { fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  tenant: { id: '42', role: 'owner' },
  tenantToken: null as string | null,
  isAuthenticated: false,
}));
const api = vi.hoisted(() => ({ getConfig: vi.fn(), setFeature: vi.fn() }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/rbac', () => ({
  usePermission: () => ({ allowed: auth.tenant.role === 'owner' || auth.tenant.role === 'manager', role: auth.tenant.role, required: 'manager' }),
}));
vi.mock('@/lib/builderforceApi', () => ({ embedApi: api }));
vi.mock('@/components/settings/EmbedIntegrationSettings', () => ({ EmbedIntegrationSettings: () => null }));
vi.mock('@/components/SlideOutPanel', () => ({ SlideOutPanel: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
const insightsSite = vi.hoisted(() => ({ siteKey: null as string | null, entitled: false as boolean | null }));
vi.mock('./useInsightsSite', () => ({ useInsightsSite: () => insightsSite }));

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
    auth.isAuthenticated = false;
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

  it('does not tell an anonymous visitor to select a workspace they cannot have', () => {
    const view = render(<EmbeddedCapabilities />);
    expect(view.queryByText('embedded.selectWorkspace')).toBeNull();

    auth.isAuthenticated = true;
    view.rerender(<EmbeddedCapabilities />);
    expect(view.queryByText('embedded.selectWorkspace')).not.toBeNull();
  });
});

describe('EmbeddedCapabilities selling surface', () => {
  beforeEach(() => {
    auth.tenantToken = null;
    auth.isAuthenticated = false;
    api.getConfig.mockReset();
    api.getConfig.mockResolvedValue(config);
  });

  it('pitches to a visitor with no workspace, and leads with the catalog size rather than "0 active"', () => {
    const view = render(<EmbeddedCapabilities />);

    expect(view.queryByLabelText('embedded.sell.label')).not.toBeNull();
    expect(view.queryByText('embedded.availableCapabilities')).not.toBeNull();
    expect(view.queryByText('embedded.activeCapabilities')).toBeNull();
  });

  it('stops pitching once the workspace has a capability live', async () => {
    auth.tenantToken = 'tenant-jwt';
    api.getConfig.mockResolvedValue({
      ...config,
      customerFeatures: { ...config.customerFeatures, heatmaps: { enabled: true, consentVersion: 1, consentedAt: null, consentedBy: null } },
    });

    const view = render(<EmbeddedCapabilities />);

    await waitFor(() => expect(view.queryByText('embedded.activeCapabilities')).not.toBeNull());
    expect(view.queryByLabelText('embedded.sell.label')).toBeNull();
  });
});

/**
 * Heatmaps are recorded by Insights session replay, which the embed boots ONLY
 * from `data-site` (an Insights site key). The surface must not imply the
 * toggle alone records anything.
 */
describe('EmbeddedCapabilities heatmaps truthfulness', () => {
  beforeEach(() => {
    auth.tenantToken = 'tenant-jwt';
    auth.isAuthenticated = true;
    insightsSite.siteKey = null;
    insightsSite.entitled = false;
    api.getConfig.mockReset();
    api.getConfig.mockResolvedValue(config);
  });

  it('without an Insights site, the heatmaps card links to Insights set-up and the tag carries no replay key', async () => {
    const view = render(<EmbeddedCapabilities />);
    const note = await view.findByTestId('insights-site-note');
    expect(note.textContent).toContain('embedded.insights.needsSite');
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/apps/insights/setup');

    fireEvent.click(view.getByRole('tab', { name: 'embedded.tabs.install' }));
    await waitFor(() => expect(api.getConfig).toHaveBeenCalled());
    const tag = view.container.querySelector('pre')?.textContent ?? '';
    expect(tag).toContain('data-builderforce-key=');
    expect(tag).not.toContain('data-site');
  });

  it('with an Insights site, the install tag carries its key so heatmaps record', async () => {
    insightsSite.siteKey = 'bfr_site_1';
    insightsSite.entitled = true;
    const view = render(<EmbeddedCapabilities />);
    const note = await view.findByTestId('insights-site-note');
    expect(note.textContent).toContain('embedded.insights.siteReady');
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/apps/insights');

    fireEvent.click(view.getByRole('tab', { name: 'embedded.tabs.install' }));
    await waitFor(() => expect(view.container.querySelector('pre')?.textContent).toContain('data-builderforce-key="bf_42"'));
    expect(view.container.querySelector('pre')?.textContent).toContain('data-site="bfr_site_1"');
    expect(view.getByText('embedded.insights.standaloneTitle')).toBeInTheDocument();
  });
});
