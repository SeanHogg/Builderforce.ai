/**
 * THE HALF OF STAGE THAT IS A PREVIEW RATHER THAN A REPORT.
 *
 * The panel used to list versions, run the harness and refuse a publish — so a seller
 * read a verdict about a product they could not see. These assertions pin the two
 * things that fixed it and the one thing that must not regress with them:
 *
 *   1. the staged candidate renders through the BUYER's own launch component, from
 *      the payload the server returned for that snapshot id;
 *   2. the limits a buyer will read are shown to the seller BEFORE they publish;
 *   3. the publish button is still the shared `isPublishable` gate and not a second
 *      reading of the findings.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReleaseRail, StagedRelease } from '@/lib/creationReleases';
import type { CandidatesView } from '@/lib/creationListings';

// The REAL catalog: these assert on the sentence a seller reads, and a
// key-passthrough mock would pass against text nobody can understand.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const railMock = vi.fn<() => Promise<ReleaseRail>>();
const stagedMock = vi.fn<() => Promise<StagedRelease>>();
const candidatesMock = vi.fn<() => Promise<CandidatesView>>();

vi.mock('@/lib/creationReleases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creationReleases')>();
  return {
    ...actual,
    creationReleaseApi: {
      ...actual.creationReleaseApi,
      rail: () => railMock(),
      staged: () => stagedMock(),
      stage: vi.fn(),
      revert: vi.fn(),
    },
  };
});

vi.mock('@/lib/creationListings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creationListings')>();
  return {
    ...actual,
    creationListingApi: { ...actual.creationListingApi, candidates: () => candidatesMock() },
  };
});

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/SlideOutPanel', () => ({
  SlideOutPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { CanvasReleasesPanel } from './CanvasReleasesPanel';

const rail = (over: Partial<ReleaseRail> = {}): ReleaseRail => ({
  listingId: 'l1', slug: 'acme-ops', kind: 'app', harness: 'deployment', live: false,
  releases: [
    { snapshotId: null, version: '1.1.0', state: 'draft', takenAtISO: null, holders: 0 },
    { snapshotId: 's1', version: '1.1.0', state: 'staged', takenAtISO: '2026-08-16T00:00:00.000Z', holders: 0 },
  ],
  ...over,
});

const candidates = (): CandidatesView => ({
  session: { objectId: null, objectKind: null, title: 'Board', kinds: ['pack'], existingListingId: null },
  objects: [{ objectId: 'o1', objectKind: 'website', title: 'Acme Ops', kinds: ['app'], existingListingId: 'l1' }],
  takeRateBps: 0,
});

const staged = (over: Partial<StagedRelease> = {}): StagedRelease => ({
  snapshotId: 's1',
  version: '1.1.0',
  harness: 'deployment',
  delivery: 'hosted',
  checks: [
    { code: 'deployment.address', group: 'runs', severity: 'pass', label: 'The address is serving' },
    { code: 'deployment.health', group: 'travels', severity: 'warn', label: 'No backend readiness route', detail: 'Static sites look like this.' },
    { code: 'stage.sandboxLimit', group: 'runs', severity: 'warn', label: 'Checked without being run in a sandbox' },
  ],
  payload: { kind: 'object', title: 'Acme Ops', objects: [], strippedFields: [] },
  launch: { mode: 'open', entitled: true, title: 'Acme Ops', url: 'https://acme.example' },
  ...over,
});

const renderPanel = () => render(
  <CanvasReleasesPanel open sessionId="sess" objectId="o1" onClose={vi.fn()} onNotice={vi.fn()} />,
);

beforeEach(() => {
  railMock.mockReset().mockResolvedValue(rail());
  candidatesMock.mockReset().mockResolvedValue(candidates());
  stagedMock.mockReset().mockResolvedValue(staged());
});

describe('the staged candidate, as a buyer receives it', () => {
  it('renders the product itself, through the buyer’s own launch surface', async () => {
    const { container } = renderPanel();
    const frame = await waitFor(() => {
      const found = container.querySelector('iframe');
      expect(found).toBeTruthy();
      return found!;
    });
    // The real address, in the buyer's `open` mode — not a metadata card and not a
    // screenshot. Same component, so it cannot agree today and drift tomorrow.
    expect(frame.getAttribute('src')).toBe('https://acme.example');
    expect(await screen.findByText(/v1\.1\.0, exactly as a buyer receives it/)).toBeInTheDocument();
  });

  it('shows the seller the limits their buyer will read, before publishing', async () => {
    renderPanel();
    const limits = await screen.findByRole('region', { name: 'Known limits' });
    expect(limits).toHaveTextContent('Checked without being run in a sandbox');
    expect(limits).toHaveTextContent('No backend readiness route');
    // Passes are findings, not limits — declaring one would teach buyers to ignore
    // the section.
    expect(limits).not.toHaveTextContent('The address is serving');
  });

  it('offers the publish when nothing blocks, and refuses it when something does', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: /publish v1\.1\.0/i })).toBeEnabled();

    stagedMock.mockResolvedValue(staged({
      checks: [{ code: 'deployment.address', group: 'runs', severity: 'block', label: 'The address is not serving' }],
    }));
    const { unmount } = renderPanel();
    await waitFor(async () => {
      const buttons = await screen.findAllByRole('button', { name: /publish v1\.1\.0/i });
      expect(buttons.at(-1)).toBeDisabled();
    });
    unmount();
  });
});

describe('which door the listing opens', () => {
  it('offers the choice for the one kind that has two, and shows what each means', async () => {
    renderPanel();
    // `app` declares ['hosted', 'copy'] — the only kind on the platform that does.
    expect(await screen.findByRole('radio', { name: /Access to your running app/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /The thing itself/i })).not.toBeChecked();
  });

  it('hides itself entirely for a kind with only one door', async () => {
    candidatesMock.mockResolvedValue({
      ...candidates(),
      objects: [{ objectId: 'o1', objectKind: 'book', title: 'A Book', kinds: ['book'], existingListingId: 'l1' }],
    });
    renderPanel();
    await screen.findByRole('region', { name: 'Known limits' });
    // A book cannot be a subscription. The control decides that from the registry
    // rather than from a prop the caller computes.
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
