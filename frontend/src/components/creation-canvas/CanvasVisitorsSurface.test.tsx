import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReplaySiteDto } from '@builderforce/interaction-contract';
import { DEFAULT_REPLAY_SITE_SETTINGS } from '@builderforce/interaction-contract';

/**
 * PRD 33 S7 — Measure ▸ Visitors: three entitlement states, no replay read for a
 * workspace without the licence, and the Insights panel docked opposite the Brain.
 */

const capability = vi.hoisted(() => ({ current: { entitled: null as boolean | null } }));
vi.mock('@/lib/useCapability', () => ({ useCapability: () => capability.current }));

const sites = vi.hoisted(() => ({ projectSite: vi.fn(), enableProjectSite: vi.fn() }));
vi.mock('@/lib/replaySitesApi', () => ({ replaySitesApi: sites }));

vi.mock('@/components/insights/InsightsHome', () => ({
  InsightsHome: ({ siteId, panelSide }: { siteId: string; panelSide?: string }) => (
    <div data-testid="insights-home" data-site={siteId} data-side={panelSide} />
  ),
}));

vi.mock('./chrome/canvasSessionContext', () => ({ useCanvasSessionFacts: () => ({ lens: 'canvas' }) }));

const reading = vi.hoisted(() => ({ current: { app: { nodeId: 'n1', title: 'Shop', projectId: 42 } as null | { nodeId: string; title: string; projectId: number | null } } }));
vi.mock('./hooks/useOperateReading', () => ({ useOperateReading: () => reading.current }));

// The proof scoreboard has its own tests (ProofScoreboard.test.tsx); here it is inert.
vi.mock('./ProjectProofScoreboard', () => ({ ProjectProofScoreboard: () => null }));

// The manager gate is RoleGate's own concern (tested there); these tests run as a manager.
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const { CanvasVisitorsSurface } = await import('./CanvasVisitorsSurface');
const { writeBrainDockPreferences, DEFAULT_BRAIN_DOCK_PREFERENCES } = await import('./brainDockPreferences');

const site: ReplaySiteDto = {
  id: 'site-1', kind: 'hosted', projectId: 42, label: 'Shop', status: 'active',
  settings: DEFAULT_REPLAY_SITE_SETTINGS, allowedOrigins: [], publicKey: null, createdAt: '2026-10-01T00:00:00.000Z',
};

const renderSurface = (onExit = vi.fn()) => {
  render(<CanvasVisitorsSurface nodes={[]} onExit={onExit} />);
  return { onExit };
};

beforeEach(() => {
  capability.current = { entitled: true };
  reading.current = { app: { nodeId: 'n1', title: 'Shop', projectId: 42 } };
  sites.projectSite.mockReset();
  sites.enableProjectSite.mockReset();
});
afterEach(() => { window.localStorage.clear(); });

describe('CanvasVisitorsSurface', () => {
  it('not entitled: offers the listing and reads NO replay data', () => {
    capability.current = { entitled: false };
    renderSurface();
    expect(screen.getByTestId('canvas-visitors-buy')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/marketplace/listing/session-replay');
    expect(sites.projectSite).not.toHaveBeenCalled();
    expect(sites.enableProjectSite).not.toHaveBeenCalled();
  });

  it('decides nothing (and reads nothing) while the entitlement is unknown', () => {
    capability.current = { entitled: null };
    renderSurface();
    expect(screen.getByTestId('canvas-visitors-loading')).toBeInTheDocument();
    expect(sites.projectSite).not.toHaveBeenCalled();
  });

  it('entitled but not recording: one switch turns the app’s hosted site on', async () => {
    sites.projectSite.mockResolvedValue(null);
    sites.enableProjectSite.mockResolvedValue(site);
    renderSurface();
    expect(await screen.findByTestId('canvas-visitors-off')).toBeInTheDocument();
    expect(sites.projectSite).toHaveBeenCalledWith(42);
    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByTestId('insights-home')).toHaveAttribute('data-site', 'site-1');
    expect(sites.enableProjectSite).toHaveBeenCalledWith(42);
  });

  it('recording: the Insights home on the app’s site, docked opposite the Brain', async () => {
    sites.projectSite.mockResolvedValue(site);
    renderSurface();
    const home = await screen.findByTestId('insights-home');
    expect(home).toHaveAttribute('data-site', 'site-1');
    // The Brain docks right by default, so the panel docks left …
    expect(home).toHaveAttribute('data-side', 'left');
    // … and flips when the Brain moves.
    act(() => { writeBrainDockPreferences({ ...DEFAULT_BRAIN_DOCK_PREFERENCES, side: 'left' }); });
    expect(screen.getByTestId('insights-home')).toHaveAttribute('data-side', 'right');
  });

  it('says so when the board has no app to record', () => {
    reading.current = { app: null };
    renderSurface();
    expect(screen.getByTestId('canvas-visitors-no-app')).toBeInTheDocument();
    expect(sites.projectSite).not.toHaveBeenCalled();
  });

  it('hands the board back on Escape', () => {
    capability.current = { entitled: false };
    const { onExit } = renderSurface();
    fireEvent.keyDown(screen.getByTestId('canvas-visitors-surface'), { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
