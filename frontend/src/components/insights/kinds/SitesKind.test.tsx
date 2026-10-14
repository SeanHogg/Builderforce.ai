import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_REPLAY_SITE_SETTINGS, replaySnippets, type ReplaySiteDto } from '@builderforce/interaction-contract';

/** PRD 33 §4.1 — the `sites` panel kind: list, settings, snippets, verify. */

const sites = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/replaySitesApi', () => ({ replaySitesApi: sites }));

// Writes are MANAGER-only (RoleGate over `insights.manageSites`); the role is driven per test.
const permission = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/lib/rbac', () => ({ usePermission: () => ({ allowed: permission.allowed, role: permission.allowed ? 'manager' : 'viewer', required: 'manager' }) }));
vi.mock('@/domains/guest/presentation/useSampleWorkspace', () => ({ useSampleWorkspace: () => ({ ready: true, signedIn: true, isSample: false }) }));

const { SitesKind } = await import('./SitesKind');

const shop: ReplaySiteDto = {
  id: 'site-1', kind: 'external', projectId: null, label: 'Shop', status: 'active',
  settings: DEFAULT_REPLAY_SITE_SETTINGS, allowedOrigins: ['https://shop.example.com'],
  publicKey: 'site-key-1', createdAt: '2026-10-13T00:00:00.000Z',
};
const app: ReplaySiteDto = {
  ...shop, id: 'site-2', kind: 'hosted', projectId: 42, label: 'Hosted app', allowedOrigins: [], publicKey: null,
};

const renderKind = (id = 'site-1') => render(<SitesKind siteId="site-1" id={id} push={vi.fn()} />);

beforeEach(() => {
  permission.allowed = true;
  sites.list.mockReset().mockResolvedValue([shop, app]);
  sites.update.mockReset();
  sites.verify.mockReset().mockResolvedValue({ scriptSeen: true, originOk: true, firstEventAt: null, firstRecordingId: null });
});

describe('SitesKind', () => {
  it('lists the workspace’s sites and opens on the requested one', async () => {
    renderKind('site-2');
    const list = await screen.findByRole('list', { name: 'insights.sites.listLabel' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['Shop', 'Hosted app']);
    expect(within(list).getByRole('button', { name: 'Hosted app' })).toHaveAttribute('aria-pressed', 'true');
    // A hosted app has no domains to allow and no snippet to paste.
    expect(screen.queryByPlaceholderText('marketplace.capability.site.domainPlaceholder')).toBeNull();
    expect(screen.getByTestId('snippet-tabs')).toHaveTextContent('marketplace.capability.snippet.hostedOn');
  });

  it('saves label, domains and privacy switches bound to the site settings', async () => {
    sites.update.mockImplementation(async (_id: string, input: Partial<ReplaySiteDto>) => ({ ...shop, ...input }));
    renderKind();
    const label = await screen.findByLabelText('marketplace.capability.site.label');
    fireEvent.change(label, { target: { value: 'Shop EU' } });
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.capability.site.removeDomain https://shop.example.com' }));
    fireEvent.change(screen.getByPlaceholderText('marketplace.capability.site.domainPlaceholder'), { target: { value: 'eu.shop.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.capability.site.addDomain' }));
    fireEvent.click(screen.getByRole('switch', { name: /consentRequired/ }));
    fireEvent.click(screen.getByTestId('sites-save'));

    expect(await screen.findByRole('status')).toHaveTextContent('insights.sites.saved');
    expect(sites.update).toHaveBeenCalledWith('site-1', {
      label: 'Shop EU',
      allowedOrigins: ['https://eu.shop.example.com'],
      settings: { ...DEFAULT_REPLAY_SITE_SETTINGS, consentRequired: true },
    });
  });

  it('a member below manager cannot save (the control is shown, inert)', async () => {
    permission.allowed = false;
    renderKind();
    const save = await screen.findByTestId('sites-save');
    expect(save.closest('[aria-disabled]')).not.toBeNull();
    fireEvent.click(save);
    expect(sites.update).not.toHaveBeenCalled();
  });

  it('refuses a domain that is not a web origin', async () => {
    renderKind();
    fireEvent.change(await screen.findByPlaceholderText('marketplace.capability.site.domainPlaceholder'), { target: { value: 'not a domain' } });
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.capability.site.addDomain' }));
    expect(screen.getByRole('alert')).toHaveTextContent('marketplace.capability.site.domainInvalid');
  });

  it('shows the three snippets for the site key, each in its own tab', async () => {
    renderKind();
    const expected = replaySnippets({ siteKey: 'site-key-1' });
    expect(await screen.findByTestId('snippet-code')).toHaveTextContent(expected.scriptTag);
    fireEvent.click(screen.getByRole('tab', { name: 'marketplace.capability.snippet.tabs.npm' }));
    expect(screen.getByTestId('snippet-code').textContent).toBe(expected.npm);
    fireEvent.click(screen.getByRole('tab', { name: 'marketplace.capability.snippet.tabs.gtm' }));
    expect(screen.getByTestId('snippet-code').textContent).toBe(expected.gtm);
    expect(screen.getByRole('tab', { name: 'marketplace.capability.snippet.tabs.gtm' })).toHaveAttribute('aria-selected', 'true');
  });

  it('runs the install checks for the selected site', async () => {
    renderKind();
    expect(await screen.findByTestId('capability-verify')).toBeInTheDocument();
    await vi.waitFor(() => expect(sites.verify).toHaveBeenCalledWith('site-1'));
  });
});
