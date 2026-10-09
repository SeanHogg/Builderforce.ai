import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { isPublishableObjectKind } from '@builderforce/creation-canvas-contract';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasSessionFacts } from './chrome/canvasSessionContext';
import type { CanvasPlaceDoors } from './CanvasLaunchSurface';

/**
 * PRD 32 W12 — Launch: the Make-it-real door laid out as a place. Four sections (Prove,
 * Publish, Sell, Tell people), each pressing a door the canvas already has.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const { CanvasLaunchSurface } = await import('./CanvasLaunchSurface');
const { CanvasSessionProvider } = await import('./chrome/canvasSessionContext');

function object(id: string, data: Record<string, unknown>): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: data as CanvasObject['data'] };
}

function doorsWith(overrides: Partial<CanvasPlaceDoors> = {}): CanvasPlaceDoors {
  return {
    prove: { run: vi.fn() },
    publish: { run: vi.fn() },
    openListing: vi.fn(),
    openReleases: vi.fn(),
    openSocial: vi.fn(),
    ...overrides,
  };
}

function renderLaunch(nodes: CanvasObject[], { doors = doorsWith(), canEdit = true }: { doors?: CanvasPlaceDoors; canEdit?: boolean } = {}) {
  const facts: CanvasSessionFacts = {
    sessionId: 'launch-test',
    persistence: 'server',
    role: 'owner' as CanvasSessionFacts['role'],
    lens: 'canvas',
    boardPath: '/create/test-board',
    canEdit,
    notify: vi.fn(),
    requireAccount: vi.fn() as unknown as CanvasSessionFacts['requireAccount'],
  };
  render(
    <CanvasSessionProvider value={facts}>
      <CanvasLaunchSurface nodes={nodes} doors={doors} onExit={vi.fn()} />
    </CanvasSessionProvider>,
  );
  return doors;
}

const game = object('g1', { kind: 'game', title: 'Yard dash' });

describe('CanvasLaunchSurface', () => {
  it('lays out all four sections in arc order', () => {
    renderLaunch([]);
    const surface = screen.getByTestId('canvas-launch-surface');
    const ids = Array.from(surface.querySelectorAll('[data-testid^="launch-"]')).map((section) => section.getAttribute('data-testid'));
    expect(ids).toEqual(['launch-prove', 'launch-publish', 'launch-sell', 'launch-tell']);
    expect(screen.getByRole('heading', { name: 'Prove it' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sell' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tell people' })).toBeInTheDocument();
  });

  it('opens the proof through the prove door', () => {
    const doors = renderLaunch([]);
    const prove = screen.getByTestId('launch-prove');
    expect(within(prove).getByText(/Hand this board’s idea to the proof picker/)).toBeInTheDocument();
    fireEvent.click(within(prove).getByRole('button', { name: 'Open the proof' }));
    expect(doors.prove.run).toHaveBeenCalledTimes(1);
  });

  it('says proving needs an account when the prove door is unavailable', () => {
    renderLaunch([], { doors: doorsWith({ prove: { run: vi.fn(), available: false } }) });
    const prove = screen.getByTestId('launch-prove');
    expect(within(prove).queryByRole('button')).not.toBeInTheDocument();
    expect(within(prove).getByText('Keep your work to an account to prove this idea.')).toBeInTheDocument();
  });

  it('publishes through the publish door and lists through the listing door', () => {
    const doors = renderLaunch([]);
    const publish = screen.getByTestId('launch-publish');
    fireEvent.click(within(publish).getByRole('button', { name: 'Open the release' }));
    expect(doors.publish.run).toHaveBeenCalledTimes(1);
    fireEvent.click(within(publish).getByRole('button', { name: 'List in the marketplace' }));
    expect(doors.openListing).toHaveBeenCalledTimes(1);
    expect(doors.openListing).toHaveBeenCalledWith();
  });

  it('disables listing for a viewer who cannot edit', () => {
    renderLaunch([], { canEdit: false });
    expect(within(screen.getByTestId('launch-publish')).getByRole('button', { name: 'List in the marketplace' })).toBeDisabled();
  });

  it('says nothing can be sold on a board with nothing sellable', () => {
    const note = object('n1', { kind: 'note', title: 'A note' });
    expect(isPublishableObjectKind('note')).toBe(false);
    renderLaunch([note]);
    const sell = screen.getByTestId('launch-sell');
    expect(within(sell).getByRole('status')).toHaveTextContent('Nothing on this board can be sold yet.');
    expect(within(sell).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers to sell the first sellable object, scoped to it', () => {
    expect(isPublishableObjectKind('game')).toBe(true);
    const doors = renderLaunch([object('n1', { kind: 'note', title: 'A note' }), game]);
    const sell = screen.getByTestId('launch-sell');
    expect(within(sell).queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(within(sell).getByRole('button', { name: 'Sell this as a Game' }));
    expect(doors.openListing).toHaveBeenCalledWith('g1');
    fireEvent.click(within(sell).getByRole('button', { name: 'Releases & staging' }));
    expect(doors.openReleases).toHaveBeenCalledWith('g1');
  });

  it('says nothing has been told yet, and opens social', () => {
    const doors = renderLaunch([]);
    const tell = screen.getByTestId('launch-tell');
    expect(within(tell).getByRole('status')).toHaveTextContent('No post or campaign on this board yet.');
    fireEvent.click(within(tell).getByRole('button', { name: 'Open social' }));
    expect(doors.openSocial).toHaveBeenCalledTimes(1);
  });

  it('counts the posts and campaigns on the board, by kind', () => {
    renderLaunch([
      object('p1', { kind: 'socialPost', title: 'One' }),
      object('p2', { kind: 'socialPost', title: 'Two' }),
      object('e1', { kind: 'emailCampaign', title: 'Newsletter' }),
    ]);
    const tell = screen.getByTestId('launch-tell');
    expect(within(tell).queryByRole('status')).not.toBeInTheDocument();
    const items = within(tell).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Social posts2', 'Email campaigns1']);
    expect(within(tell).queryByText('Social campaigns')).not.toBeInTheDocument();
  });
});
