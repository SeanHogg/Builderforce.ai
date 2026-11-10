import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RunScanPanel, scanStatusKey } from './RunScanPanel';
import { acceptPrRisk, getPrGate, listOpenPullRequests, listScannableRepos, type PrGateState } from '@/lib/governanceDevsecopsApi';

/**
 * Accepting a PR's risk binds the decision to ONE commit. Pinned: a gate answer for a PR no longer
 * selected is dropped (a quick A -> B switch where A answers last never shows A's commit under B,
 * nor sends A's SHA for B); a gate-load failure has its own message; an unknown scan status is
 * worded, never a raw key.
 */
vi.mock('@/lib/governanceDevsecopsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/governanceDevsecopsApi')>()),
  listScannableRepos: vi.fn(),
  listOpenPullRequests: vi.fn(),
  getPrGate: vi.fn(),
  acceptPrRisk: vi.fn(),
  runBranchScan: vi.fn(),
}));
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/SlideOutPanel', () => ({
  SlideOutPanel: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}));
vi.mock('@/components/Select', () => ({
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
}));
vi.mock('./GateReasonList', () => ({ GateReasonList: () => null }));

const gateOf = vi.mocked(getPrGate);
const accept = vi.mocked(acceptPrRisk);

const gate = (headSha: string): PrGateState => ({ headSha, reasons: [], allowed: false } as unknown as PrGateState);

beforeEach(() => {
  vi.mocked(listScannableRepos).mockResolvedValue([]);
  vi.mocked(listOpenPullRequests).mockResolvedValue([
    { id: 'A', number: 1, url: null, branchName: 'a' },
    { id: 'B', number: 2, url: null, branchName: 'b' },
  ]);
  gateOf.mockReset();
  accept.mockReset();
});

describe('RunScanPanel accept risk', () => {
  it('regression: a slow gate answer for PR A is never shown or accepted under PR B', async () => {
    const answers: Record<string, (g: PrGateState) => void> = {};
    gateOf.mockImplementation((id: string) => new Promise<PrGateState>((resolve) => { answers[id] = resolve; }));
    accept.mockResolvedValue({ headSha: 'bbbbbbbbbbbbbbbb', alreadyAccepted: false } as never);
    render(<RunScanPanel open onClose={() => {}} onDone={() => {}} />);
    const select = await screen.findByLabelText('governance.runScan.pickPr');
    await act(async () => { fireEvent.change(select, { target: { value: 'B' } }); });

    await act(async () => { answers.A!(gate('aaaaaaaaaaaaaaaa')); });
    expect(screen.queryByText(/aaaaaaaaaaaa/)).toBeNull();

    await act(async () => { answers.B!(gate('bbbbbbbbbbbbbbbb')); });
    expect(screen.getByText(/governance\.runScan\.headCommit bbbbbbbbbbbb/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('governance.runScan.reason'), { target: { value: 'scanner cannot read this repo' } });
    await act(async () => { fireEvent.click(screen.getByText('governance.runScan.accept')); });
    expect(accept).toHaveBeenCalledWith('B', 'scanner cannot read this repo', 'bbbbbbbbbbbbbbbb');
  });

  it('a gate-load failure has its own message', async () => {
    gateOf.mockRejectedValue(new Error('down'));
    render(<RunScanPanel open onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText('governance.runScan.loadGateError')).toBeTruthy();
  });
});

describe('RunScanPanel gate messages', () => {
  it('regression: a gate-load failure for PR A is cleared when PR B is chosen', async () => {
    gateOf.mockImplementation((id: string) => (id === 'A' ? Promise.reject(new Error('down')) : Promise.resolve(gate('bbbbbbbbbbbbbbbb'))));
    render(<RunScanPanel open onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText('governance.runScan.loadGateError')).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByLabelText('governance.runScan.pickPr'), { target: { value: 'B' } }); });
    expect(screen.queryByText('governance.runScan.loadGateError')).toBeNull();
    expect(screen.getByText(/governance\.runScan\.headCommit bbbbbbbbbbbb/)).toBeTruthy();
  });
});

describe('scanStatusKey', () => {
  it('maps known statuses and falls back for unknown ones', () => {
    expect(scanStatusKey('failed')).toBe('status.failed');
    expect(scanStatusKey('quarantined')).toBe('statusUnknown');
  });
});
