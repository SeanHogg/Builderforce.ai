import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { CanvasSessionFacts } from './chrome/canvasSessionContext';
import type { SiteAudienceSummary } from '@/lib/siteAudienceApi';

/**
 * Operate → People: who the published app reached, from `/site/audience-summary`.
 * Published → the stat row; not published (or no durable project) → the publish hint
 * and nothing else; in flight → a localized loading line.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const summary = vi.fn<(projectId: number | string, days?: number) => Promise<SiteAudienceSummary>>();
vi.mock('@/lib/siteAudienceApi', () => ({ siteAudienceApi: { summary: (...args: [number, number]) => summary(...args) } }));

const { OperatePeopleSection } = await import('./OperatePeopleSection');
const { CanvasSessionProvider } = await import('./chrome/canvasSessionContext');

function renderPeople(projectId: number | null, persistence: CanvasSessionFacts['persistence'] = 'server') {
  const facts: CanvasSessionFacts = {
    sessionId: 'people-test',
    persistence,
    role: 'owner' as CanvasSessionFacts['role'],
    lens: 'canvas',
    boardPath: '/create/test-board',
    canEdit: true,
    notify: vi.fn(),
    requireAccount: vi.fn() as unknown as CanvasSessionFacts['requireAccount'],
  };
  return render(
    <CanvasSessionProvider value={facts}>
      <OperatePeopleSection projectId={projectId} />
    </CanvasSessionProvider>,
  );
}

const published: SiteAudienceSummary = {
  published: true,
  users: 1234,
  newUsers: 56,
  visitors: 789,
  pageViews: 4321,
  leads: 12,
  days: 30,
  approximateTraffic: true,
};

beforeEach(() => {
  summary.mockReset();
});

describe('OperatePeopleSection', () => {
  it('shows users, new sign-ups, approximate visitors, page views and leads once published', async () => {
    summary.mockResolvedValue(published);
    renderPeople(42);
    expect(await screen.findByTestId('operate-people-stats')).toBeInTheDocument();
    expect(summary).toHaveBeenCalledWith(42, 30);
    expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument();
    expect(within(screen.getByTestId('operate-people-users')).getByText('1,234')).toBeInTheDocument();
    expect(within(screen.getByTestId('operate-people-users')).getByText('Users')).toBeInTheDocument();
    expect(within(screen.getByTestId('operate-people-new-users')).getByText('56')).toBeInTheDocument();
    expect(within(screen.getByTestId('operate-people-new-users')).getByText('New sign-ups, last 30 days')).toBeInTheDocument();
    expect(within(screen.getByTestId('operate-people-visitors')).getByText('~789')).toBeInTheDocument();
    expect(within(screen.getByTestId('operate-people-page-views')).getByText('4,321')).toBeInTheDocument();
    expect(within(screen.getByTestId('operate-people-leads')).getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('Publish the app to see who signs up.')).not.toBeInTheDocument();
  });

  it('asks for a publish, and shows no numbers, when the project has no site', async () => {
    summary.mockResolvedValue({ ...published, published: false, users: 0, newUsers: 0, visitors: 0, pageViews: 0, leads: 0 });
    renderPeople(42);
    expect(await screen.findByText('Publish the app to see who signs up.')).toBeInTheDocument();
    expect(screen.queryByTestId('operate-people-stats')).not.toBeInTheDocument();
  });

  it('asks for a publish without fetching when there is no durable project yet', () => {
    renderPeople(null);
    expect(screen.getByRole('status')).toHaveTextContent('Publish the app to see who signs up.');
    expect(summary).not.toHaveBeenCalled();
  });

  it('does not fetch for a browser-local session', () => {
    renderPeople(42, 'local');
    expect(summary).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Publish the app to see who signs up.');
  });

  it('says it is counting while the summary is in flight', () => {
    summary.mockReturnValue(new Promise(() => {}));
    renderPeople(42);
    expect(screen.getByRole('status')).toHaveTextContent('Counting who signed up…');
    expect(screen.queryByTestId('operate-people-stats')).not.toBeInTheDocument();
  });

  it('says so when the summary cannot be read', async () => {
    summary.mockRejectedValue(new Error('boom'));
    renderPeople(42);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load who signed up.');
  });
});
