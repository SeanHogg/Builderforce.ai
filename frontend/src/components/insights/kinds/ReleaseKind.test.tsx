import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReplayReleaseReportDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { ReleaseKind } from './ReleaseKind';

/**
 * The `release` kind: one release's improvement ledger — every fix it shipped,
 * its verdict, its measured before → after — and Revert only where the API
 * offers it (`next`), after a confirm.
 */

const confirmSpy = vi.hoisted(() => vi.fn<(opts: unknown) => Promise<boolean>>());
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));

const measured = (verdict: 'worked' | 'worse', before: number, after: number) => ({
  before, after, delta: after - before, verdict, source: 'ticket_effect' as const, releaseKey: 'rel-b', measuredAt: '2026-10-10T00:00:00.000Z',
});

const report: ReplayReleaseReportDto = {
  releaseKey: 'rel-b',
  label: 'Spring launch',
  firstSeenAt: '2026-10-05T00:00:00.000Z',
  prescriptions: [
    { id: 'rx-good', ruleId: 'rage_on_element', area: 'ux', status: 'worked', actionKind: 'fix', measured: measured('worked', 0.08, 0.03) },
    { id: 'rx-bad', ruleId: 'cta_below_fold', area: 'site', status: 'worse', actionKind: 'fix', measured: measured('worse', 0.03, 0.02) },
    { id: 'rx-open', ruleId: 'device_gap', area: 'site', status: 'measuring', actionKind: 'ticket', measured: null },
  ],
};

beforeEach(() => {
  confirmSpy.mockReset();
  vi.spyOn(replayApi, 'releaseReport').mockResolvedValue(report);
  vi.spyOn(replayApi, 'listPrescriptions').mockResolvedValue([
    prescription({ id: 'rx-good', status: 'worked', next: [] }),
    prescription({
      id: 'rx-bad',
      ruleId: 'cta_below_fold',
      area: 'site',
      status: 'worse',
      next: ['revert'],
      refs: { taskId: 7, testId: null, previewRelease: 'rel-p', liveRelease: 'rel-a', sequenceObjectId: null },
    }),
  ]);
  vi.spyOn(replayApi, 'actOnPrescription').mockResolvedValue({ prescription: prescription({ id: 'rx-bad', status: 'worse', next: [] }) });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReleaseKind', () => {
  it('lists every fix the release shipped with its verdict and before → after', async () => {
    const push = vi.fn();
    render(<ReleaseKind siteId="site-1" id="rel-b" push={push} />);
    expect(await screen.findByText('insights.release.title Spring launch')).toBeInTheDocument();
    expect(replayApi.releaseReport).toHaveBeenCalledWith('site-1', 'rel-b');
    const items = within(screen.getByTestId('release-fixes')).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-verdict'))).toEqual(['worked', 'worse', 'measuring']);
    expect(items[0]).toHaveTextContent('replay.prescription.measured.beforeAfter 0.08 0.03');
    expect(items[2]).toHaveTextContent('insights.release.notMeasured');

    fireEvent.click(within(items[0]!).getByRole('button', { name: /^insights\.release\.openAria / }));
    expect(push).toHaveBeenCalledWith({ kind: 'fix', id: 'rx-good', tab: 'measure' });
  });

  it('offers Revert only where the API does, and only after a confirm', async () => {
    render(<ReleaseKind siteId="site-1" id="rel-b" push={vi.fn()} />);
    await screen.findByTestId('release-fixes');
    const reverts = await screen.findAllByRole('button', { name: /replay\.prescription\.actions\.revert/ });
    expect(reverts).toHaveLength(1);
    const items = within(screen.getByTestId('release-fixes')).getAllByRole('listitem');
    expect(within(items[1]!).getByRole('button', { name: /replay\.prescription\.actions\.revert/ })).toBe(reverts[0]);

    confirmSpy.mockResolvedValueOnce(false);
    fireEvent.click(reverts[0]!);
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(replayApi.actOnPrescription).not.toHaveBeenCalled();

    confirmSpy.mockResolvedValueOnce(true);
    fireEvent.click(reverts[0]!);
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-bad', 'revert', {}));
  });

  it('says so when the release shipped no fix', async () => {
    vi.mocked(replayApi.releaseReport).mockResolvedValue({ ...report, prescriptions: [] });
    render(<ReleaseKind siteId="site-1" id="rel-b" push={vi.fn()} />);
    expect(await screen.findByText('insights.release.empty')).toBeInTheDocument();
  });
});

