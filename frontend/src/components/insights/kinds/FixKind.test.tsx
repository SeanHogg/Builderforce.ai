import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import type { ReplayIssueDetailDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { InsightsScopeProvider } from '../insightsScope';
import { panelKindDef } from '../panelKinds';
import { FixChangeTab, FixMeasureTab, IssueFixTab, IssueHistoryTab } from './FixKind';

/**
 * The `fix` kind (Change · Measure) and the `issue` kind's Fix and History tabs:
 * one prescription by id — THE card in full, the acceptance test, the measured
 * verdict and the status history; an issue with no prescription says so.
 */

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));

const issue = (over: Partial<ReplayIssueDetailDto> = {}): ReplayIssueDetailDto => ({
  id: 'iss-1',
  fingerprint: 'fp-rage',
  kind: 'rage',
  route: '/pricing',
  subject: 'button.buy',
  title: 'Rage clicks on Buy',
  status: 'proposed',
  sessions: 120,
  share: 0.042,
  sparkline: [],
  firstRelease: null,
  lastRelease: null,
  firstSeenAt: '2026-10-01T00:00:00.000Z',
  lastSeenAt: '2026-10-09T00:00:00.000Z',
  prescriptionId: 'rx-1',
  representatives: [],
  byRelease: [],
  byDevice: [],
  ...over,
});

const measured = prescription({
  status: 'worked',
  actionKind: 'fix',
  next: [],
  measured: { before: 0.08, after: 0.03, delta: -0.05, verdict: 'worked', source: 'ticket_effect', releaseKey: 'rel-b', measuredAt: '2026-10-10T00:00:00.000Z' },
});

function renderTab(Tab: typeof FixChangeTab, id = 'rx-1') {
  render(
    <InsightsScopeProvider siteId="site-1">
      <Tab siteId="site-1" id={id} push={vi.fn()} />
    </InsightsScopeProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights');
  vi.spyOn(replayApi, 'getPrescription').mockResolvedValue(prescription());
  vi.spyOn(replayApi, 'getIssue').mockResolvedValue(issue());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fix kind', () => {
  it('is registered with Change and Measure tabs, and the issue kind with Fix and History', () => {
    expect(panelKindDef('fix')?.tabs.map((tab) => tab.id)).toEqual(['change', 'measure']);
    expect(panelKindDef('issue')?.tabs.map((tab) => tab.id)).toEqual(['overview', 'recordings', 'fix', 'history']);
    expect(panelKindDef('fixes')?.tabs.map((tab) => tab.id)).toEqual(['main']);
  });

  it('Change: THE card in full, with its actions', async () => {
    renderTab(FixChangeTab);
    const card = await screen.findByTestId('prescription-card');
    expect(card).not.toHaveAttribute('data-compact');
    expect(replayApi.getPrescription).toHaveBeenCalledWith('site-1', 'rx-1');
    expect(card.querySelectorAll('[data-action]')).toHaveLength(3);
  });

  it('Measure: the acceptance test, the verdict and the history', async () => {
    vi.mocked(replayApi.getPrescription).mockResolvedValue(measured);
    renderTab(FixMeasureTab);
    expect(await screen.findByText(/^replay\.prescription\.acceptance\.text replay\.prescription\.metric\.rage_rate replay\.prescription\.acceptance\.direction\.down 200$/)).toBeInTheDocument();
    expect(screen.getByTestId('prescription-measured')).toHaveAttribute('data-verdict', 'worked');
    const history = [...screen.getByTestId('fix-history').querySelectorAll('li')].map((li) => li.getAttribute('data-entry'));
    expect(history).toEqual(['created', 'applied', 'measured']);
  });

  it('Measure before a verdict says it is not measured yet', async () => {
    renderTab(FixMeasureTab);
    expect(await screen.findByText('insights.fix.measure.notYet')).toBeInTheDocument();
  });
});

describe('issue kind — Fix and History', () => {
  it('Fix shows the issue’s prescription by its id', async () => {
    renderTab(IssueFixTab, 'iss-1');
    expect(await screen.findByTestId('prescription-card')).toBeInTheDocument();
    expect(replayApi.getIssue).toHaveBeenCalledWith('site-1', 'iss-1', { days: 30 });
    expect(replayApi.getPrescription).toHaveBeenCalledWith('site-1', 'rx-1');
  });

  it('History shows its status history', async () => {
    vi.mocked(replayApi.getPrescription).mockResolvedValue(measured);
    renderTab(IssueHistoryTab, 'iss-1');
    expect(await screen.findByTestId('fix-history')).toBeInTheDocument();
  });

  it('says so when no fix has been prescribed for the issue', async () => {
    vi.mocked(replayApi.getIssue).mockResolvedValue(issue({ prescriptionId: null }));
    renderTab(IssueFixTab, 'iss-1');
    expect(await screen.findByText('insights.fix.noFix')).toBeInTheDocument();
    expect(replayApi.getPrescription).not.toHaveBeenCalled();
  });
});
