import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import { boardDeployments, isLiveDeployment } from '@/lib/canvas/boardDeployments';
import type { CanvasSessionFacts } from './chrome/canvasSessionContext';

/**
 * PRD 32 W11 — Operate: what this session has RUNNING. Deployments (live → the list with
 * its address; an app but nothing deployed → Publish the app; no app → Go to Make / Let
 * Brain build), releases and the app, each through a door the canvas already has.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const { CanvasOperateSurface } = await import('./CanvasOperateSurface');
const { renderWithPhase } = await import('./phase/testPhaseProvider');
const { CanvasSessionProvider } = await import('./chrome/canvasSessionContext');

/** The People section reads the session facts; these boards hold only local apps, so it
 *  never fetches (its own fetch paths are covered in `operatePeopleSection.test.tsx`). */
const facts: CanvasSessionFacts = {
  sessionId: 'operate-test',
  persistence: 'server',
  role: 'owner' as CanvasSessionFacts['role'],
  lens: 'canvas',
  canEdit: true,
  notify: vi.fn(),
  requireAccount: vi.fn() as unknown as CanvasSessionFacts['requireAccount'],
};

function object(id: string, data: Record<string, unknown>): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: data as CanvasObject['data'] };
}

const app = object('a1', { kind: 'build', title: 'Yard app', localAppKey: 'operate-surface-test-app' });
const liveDeploy = object('d1', { kind: 'deployment', title: 'Prod', environmentName: 'production', version: 'v1.2.0', url: 'https://yard.example.com', deployedAt: '2026-10-01T10:00:00Z' });
const plannedDeploy = object('d2', { kind: 'deployment', title: 'Staging', environmentName: 'staging' });
const release = object('r1', { kind: 'release', title: 'October release', status: 'staged' });

function renderOperate(nodes: CanvasObject[]) {
  const onOpenApp = vi.fn();
  const onOpenReleases = vi.fn();
  const { askBrain, publishApp, setPhase } = renderWithPhase(
    <CanvasSessionProvider value={facts}>
      <CanvasOperateSurface nodes={nodes} onExit={vi.fn()} onOpenApp={onOpenApp} onOpenReleases={onOpenReleases} />
    </CanvasSessionProvider>,
    { phase: 'run', nodes },
  );
  return { askBrain, publishApp, setPhase, onOpenApp, onOpenReleases };
}

describe('CanvasOperateSurface — deployments', () => {
  it('lists a live deployment with its address as a link', () => {
    renderOperate([app, liveDeploy]);
    const section = screen.getByTestId('operate-deployments');
    const list = within(section).getByTestId('deployment-list');
    expect(within(list).getByText('production')).toBeInTheDocument();
    expect(within(list).getByText('v1.2.0')).toBeInTheDocument();
    const link = within(list).getByRole('link', { name: 'https://yard.example.com' });
    expect(link).toHaveAttribute('href', 'https://yard.example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(within(section).queryByRole('status')).not.toBeInTheDocument();
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('operate-app')).getByText('Yard app · live')).toBeInTheDocument();
  });

  it("says there's an app but nothing deployed, and opens its Publish panel", () => {
    const { askBrain, publishApp } = renderOperate([app, plannedDeploy]);
    const section = screen.getByTestId('operate-deployments');
    // The planned card is still listed, as planned.
    expect(within(section).getByText('No address yet — planned, not live')).toBeInTheDocument();
    expect(within(section).queryByRole('link')).not.toBeInTheDocument();
    expect(within(section).getByRole('status')).toHaveTextContent('There’s an app but nothing deployed.');
    expect(within(section).queryByRole('button', { name: 'Go to Make' })).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Publish the app' }));
    expect(publishApp).toHaveBeenCalledTimes(1);
    expect(askBrain).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('operate-app')).getByText('Yard app · not deployed')).toBeInTheDocument();
  });

  it('with an app and no deployment card at all, still offers the deploy', () => {
    renderOperate([app]);
    const section = screen.getByTestId('operate-deployments');
    expect(within(section).queryByTestId('deployment-list')).not.toBeInTheDocument();
    expect(within(section).getByRole('status')).toHaveTextContent('There’s an app but nothing deployed.');
    expect(within(section).getByRole('button', { name: 'Publish the app' })).toBeInTheDocument();
  });

  it('with no app, sends the reader to Make or lets Brain build it', () => {
    const { askBrain, setPhase } = renderOperate([]);
    const section = screen.getByTestId('operate-deployments');
    expect(within(section).getByRole('status')).toHaveTextContent('Nothing is built yet, so there is nothing to run.');
    fireEvent.click(within(section).getByRole('button', { name: 'Go to Make' }));
    expect(setPhase).toHaveBeenCalledWith('make');
    fireEvent.click(within(section).getByRole('button', { name: 'Let Brain build it' }));
    expect(askBrain).toHaveBeenCalledWith('Build the first working version of the app for the idea on this board.');
    const appSection = screen.getByTestId('operate-app');
    expect(within(appSection).getByText('No app on this board yet.')).toBeInTheDocument();
    expect(within(appSection).queryByRole('button', { name: 'Open App' })).not.toBeInTheDocument();
  });
});

describe('CanvasOperateSurface — releases and app', () => {
  it('lists the board releases and opens the release lifecycle', () => {
    const { onOpenReleases } = renderOperate([app, release]);
    const section = screen.getByTestId('operate-releases');
    expect(within(section).getByText('October release')).toBeInTheDocument();
    expect(within(section).getByText('staged')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Open releases' }));
    expect(onOpenReleases).toHaveBeenCalledTimes(1);
  });

  it('says when there is no release yet', () => {
    renderOperate([app]);
    expect(within(screen.getByTestId('operate-releases')).getByText(/No release on this board yet/)).toBeInTheDocument();
  });

  it('places People between Deployments and Releases, and asks for a publish when the app has no project', () => {
    renderOperate([app, liveDeploy]);
    const surface = screen.getByTestId('canvas-operate-surface');
    const ids = Array.from(surface.querySelectorAll('[data-testid^="operate-"]'))
      .map((section) => section.getAttribute('data-testid'))
      .filter((id) => ['operate-deployments', 'operate-people', 'operate-releases', 'operate-app'].includes(id ?? ''));
    expect(ids).toEqual(['operate-deployments', 'operate-people', 'operate-releases', 'operate-app']);
    expect(within(screen.getByTestId('operate-people')).getByRole('status')).toHaveTextContent('Publish the app to see who signs up');
  });

  it('opens the app', () => {
    const { onOpenApp } = renderOperate([app, liveDeploy]);
    fireEvent.click(within(screen.getByTestId('operate-app')).getByRole('button', { name: 'Open App' }));
    expect(onOpenApp).toHaveBeenCalledTimes(1);
  });
});

describe('boardDeployments', () => {
  const node = (id: string, data: Record<string, unknown>) => ({ id, data });

  it('reads only deployment cards, newest first, undated ones last in board order', () => {
    const read = boardDeployments([
      node('undated-1', { kind: 'deployment', title: 'A' }),
      node('old', { kind: 'deployment', title: 'Old', deployedAt: '2026-01-01T00:00:00Z' }),
      node('note', { kind: 'note', title: 'Not a deployment', deployedAt: '2026-12-01T00:00:00Z' }),
      node('new', { kind: 'deployment', title: 'New', deployedAt: '2026-09-01T00:00:00Z' }),
      node('undated-2', { kind: 'deployment', title: 'B', deployedAt: 'not a date' }),
    ]);
    expect(read.map((deployment) => deployment.id)).toEqual(['new', 'old', 'undated-1', 'undated-2']);
  });

  it('normalises blank fields to null and trims text', () => {
    const [deployment] = boardDeployments([node('d', { kind: 'deployment', title: '  Prod  ', environmentName: ' ', version: 'v2', url: '  https://x.example  ' })]);
    expect(deployment).toEqual({ id: 'd', title: 'Prod', environment: null, version: 'v2', url: 'https://x.example', deployedAt: null });
  });
});

describe('isLiveDeployment', () => {
  it('is live only for a deployment with an address', () => {
    expect(isLiveDeployment({ kind: 'deployment', url: 'https://x.example' })).toBe(true);
    expect(isLiveDeployment({ kind: 'deployment' })).toBe(false);
    expect(isLiveDeployment({ kind: 'deployment', url: '   ' })).toBe(false);
    expect(isLiveDeployment({ kind: 'note', url: 'https://x.example' })).toBe(false);
  });
});
