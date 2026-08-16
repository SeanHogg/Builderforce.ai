import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  overview: vi.fn(),
  sessionAppState: vi.fn(),
  addressAvailable: vi.fn(),
  convertToApp: vi.fn(),
  appAddress: vi.fn(),
}));

vi.mock('@/lib/embeddedApps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/embeddedApps')>()),
  embeddedAppsApi: api,
}));

const { ProjectAppPanel } = await import('./ProjectAppPanel');

const SITE = {
  subdomain: 'sunday-rsvp',
  mode: 'static',
  status: 'active',
  versionToken: 'v7',
  assetCount: 12,
  totalBytes: 1_048_576,
  publishedAt: '2026-08-01T00:00:00.000Z',
  url: 'https://sunday-rsvp.builderforce.app',
  pathUrl: '/api/sites/sunday-rsvp/',
};

const overview = (patch: Record<string, unknown> = {}) => ({
  site: SITE, domain: null, collections: [], traffic: null, ...patch,
});

beforeEach(() => {
  for (const spy of Object.values(api)) spy.mockReset();
});

describe('ProjectAppPanel — deciding its own visibility', () => {
  /**
   * No site means the project is not an app. The precondition lives here so the
   * host cannot get it wrong — and so every project page that is not an app
   * stays exactly as it was.
   */
  it('renders nothing for a project with no site', async () => {
    api.overview.mockResolvedValue(overview({ site: null }));
    const { container } = render(<ProjectAppPanel projectId={42} />);
    await waitFor(() => expect(api.overview).toHaveBeenCalledWith(42));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the reads fail rather than an error card', async () => {
    api.overview.mockRejectedValue(new Error('offline'));
    const { container } = render(<ProjectAppPanel projectId={42} />);
    await waitFor(() => expect(api.overview).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ProjectAppPanel — statements, not settings', () => {
  /**
   * Operator decision 3: no host choice and no database choice. A control here
   * would imply a decision the platform will not honour, so the panel must carry
   * no form control at all.
   */
  it('offers no picker, no input and no toggle', async () => {
    api.overview.mockResolvedValue(overview({
      collections: [{ id: 1, name: 'signups', recordCount: 4, audienceId: null, acceptsPublicWrites: true, dailyWriteCap: 2000, createdAt: '', endpoint: '' }],
      traffic: { days: [], totals: { pageViews: 40, visitors: 12, assetHits: 0, bytesServed: 0 }, approximate: true },
    }));
    const { container } = render(<ProjectAppPanel projectId={42} />);
    await screen.findByText(/runtimeStatement/);
    expect(container.querySelectorAll('select, input, textarea')).toHaveLength(0);
  });

  it('states the address, the build it serves, the data and the people', async () => {
    api.overview.mockResolvedValue(overview({
      collections: [
        { id: 1, name: 'signups', recordCount: 4, audienceId: null, acceptsPublicWrites: true, dailyWriteCap: 2000, createdAt: '', endpoint: '' },
        { id: 2, name: 'members', recordCount: 11, audienceId: 3, acceptsPublicWrites: false, dailyWriteCap: 2000, createdAt: '', endpoint: '' },
      ],
      traffic: { days: [], totals: { pageViews: 40, visitors: 12, assetHits: 0, bytesServed: 0 }, approximate: true },
    }));
    render(<ProjectAppPanel projectId={42} />);

    expect(await screen.findByRole('link', { name: 'sunday-rsvp.builderforce.app' }))
      .toHaveAttribute('href', 'https://sunday-rsvp.builderforce.app');
    expect(screen.getByText(/runtimeServing v7 1\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();   // records, both collections
    expect(screen.getByText('12')).toBeInTheDocument();   // visitors
    expect(screen.getByText(/peopleApproximate/)).toBeInTheDocument();
  });

  /**
   * Conversion reserves the address with an EMPTY site row, so a site existing
   * does not mean anything is served there. Saying "live" then would send the
   * creator to share a link that 404s.
   */
  it('separates a reserved address from a live one', async () => {
    api.overview.mockResolvedValue(overview({ site: { ...SITE, assetCount: 0, totalBytes: 0 } }));
    render(<ProjectAppPanel projectId={42} />);
    expect(await screen.findByText(/badgeReserved/)).toBeInTheDocument();
    expect(screen.queryByText(/badgeLive/)).not.toBeInTheDocument();
    expect(screen.getByText(/runtimeNothingServed/)).toBeInTheDocument();
  });

  it('shows a custom domain only once it is genuinely reachable', async () => {
    api.overview.mockResolvedValue(overview({
      domain: { hostname: 'rsvp.example.com', status: 'pending_certificate', live: false, verifiedAt: null, error: null, instructions: null },
    }));
    render(<ProjectAppPanel projectId={42} />);
    await screen.findByText(/runtimeStatement/);
    expect(screen.queryByText('rsvp.example.com')).not.toBeInTheDocument();
  });

  it('says so plainly when nobody has been yet', async () => {
    api.overview.mockResolvedValue(overview({
      traffic: { days: [], totals: { pageViews: 0, visitors: 0, assetHits: 0, bytesServed: 0 }, approximate: true },
    }));
    render(<ProjectAppPanel projectId={42} />);
    expect(await screen.findByText(/peopleNobodyYet/)).toBeInTheDocument();
    expect(screen.getByText(/dataEmpty/)).toBeInTheDocument();
  });
});
