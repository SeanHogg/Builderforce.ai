/**
 * @vitest-environment jsdom
 *
 * The "BuilderForce surfaces" tab on /embedded rendered as an EMPTY tab for a
 * signed-out visitor (and for any member below manager): the panel returned
 * null unless the caller was a signed-in owner/manager. The catalog of surfaces
 * and the install walkthrough are true for everyone; only the controls are
 * gated, and they gate the way the rest of the app does — inert, with the
 * "create an account" / "requires role" notice — never by vanishing.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const auth = vi.hoisted(() => ({ current: { tenantToken: null as string | null } }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => auth.current }));

const permission = vi.hoisted(() => ({
  current: { allowed: false, role: undefined as string | undefined, required: 'manager' },
}));
vi.mock('@/lib/rbac', () => ({ usePermission: () => permission.current }));

const sampleWorkspace = vi.hoisted(() => ({ current: { ready: true, signedIn: false, isSample: true } }));
vi.mock('@/domains/guest/presentation/useSampleWorkspace', () => ({
  useSampleWorkspace: () => sampleWorkspace.current,
}));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/embedded',
}));

const api = vi.hoisted(() => ({ getConfig: vi.fn(), setConfig: vi.fn() }));
vi.mock('@/lib/builderforceApi', () => ({ embedApi: api }));
vi.mock('./EmbedConsentModal', () => ({ EmbedConsentModal: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import { EmbedIntegrationSettings } from './EmbedIntegrationSettings';

const config = {
  enabled: true,
  capabilities: ['agile'],
  consentVersion: 1,
  consentRequiredVersion: 1,
};

describe('EmbedIntegrationSettings', () => {
  beforeEach(() => {
    api.getConfig.mockReset();
    api.getConfig.mockResolvedValue(config);
  });

  it('shows a signed-out visitor the surface catalog, the install walkthrough and an account notice — never an empty tab', () => {
    auth.current = { tenantToken: null };
    permission.current = { allowed: false, role: undefined, required: 'manager' };
    sampleWorkspace.current = { ready: true, signedIn: false, isSample: true };

    render(<EmbedIntegrationSettings />);

    expect(screen.getByText('BuilderForce app surfaces')).toBeTruthy();
    expect(screen.getByText('What a host can mount')).toBeTruthy();
    // Once in the catalog, once in the preview snippet's mountable-view list.
    expect(screen.getAllByText('kanban').length).toBe(2);
    expect(screen.getAllByText('soc2').length).toBe(2);
    expect(screen.getByText('Install in your host app')).toBeTruthy();
    expect(screen.getByRole('note')).toBeTruthy();
    expect(screen.getByText('Create an account')).toBeTruthy();
    expect(screen.queryByText(/Requires .* role/)).toBeNull();
    expect(api.getConfig).not.toHaveBeenCalled();
  });

  it('shows a signed-in member below manager the same content with the honest role hint', () => {
    auth.current = { tenantToken: 'tenant-jwt' };
    permission.current = { allowed: false, role: 'developer', required: 'manager' };
    sampleWorkspace.current = { ready: true, signedIn: true, isSample: false };

    render(<EmbedIntegrationSettings />);

    expect(screen.getByText('What a host can mount')).toBeTruthy();
    expect(screen.queryByText('Create an account')).toBeNull();
    expect(screen.getByText(/Manager/)).toBeTruthy();
    expect(api.getConfig).not.toHaveBeenCalled();
  });

  it('loads the workspace config for a manager and marks the live area in the catalog', async () => {
    auth.current = { tenantToken: 'tenant-jwt' };
    permission.current = { allowed: true, role: 'manager', required: 'manager' };
    sampleWorkspace.current = { ready: true, signedIn: true, isSample: false };

    render(<EmbedIntegrationSettings />);

    await waitFor(() => expect(api.getConfig).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Live')).toBeTruthy());
    expect((screen.getByLabelText('Enable embedded app surfaces') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
