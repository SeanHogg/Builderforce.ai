import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CanvasPhoneAppBar } from './CanvasPhoneAppBar';
import { CanvasSurfaceStrip } from './CanvasSurfaceStrip';
import { renderWithPhase } from './phase/testPhaseProvider';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const faces = [
  { userId: 'a', displayName: 'Ada Hogg' },
  { userId: 'b', displayName: 'Bob Hogg' },
  { userId: 'c', displayName: 'Cara Hogg' },
];

function renderBar(overrides: Partial<React.ComponentProps<typeof CanvasPhoneAppBar>> = {}) {
  return render(
    <CanvasPhoneAppBar
      title="Dog walking for towers"
      phase="idea"
      onPhaseChange={vi.fn()}
      surface="graph"
      onSurfaceChange={vi.fn()}
      roster={faces}
      boardMenu={<button type="button">More session actions</button>}
      {...overrides}
    />,
  );
}

describe('CanvasPhoneAppBar', () => {
  it('draws back, title, stage, roster and the board-menu host', () => {
    const onBack = vi.fn();
    renderBar({ onBack });

    expect(screen.getByTestId('canvas-app-bar')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('canvas-app-bar-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Dog walking for towers')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-app-bar-stage')).toHaveTextContent('Idea');
    expect(screen.getByTestId('canvas-app-bar-roster')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More session actions' })).toBeInTheDocument();
  });

  it('omits the back button when the host has no library to leave to', () => {
    renderBar();
    expect(screen.queryByTestId('canvas-app-bar-back')).toBeNull();
  });

  it('caps the roster faces at two and names the overflow', () => {
    renderBar();
    const roster = screen.getByTestId('canvas-app-bar-roster');
    expect(roster.textContent).toContain('AH');
    expect(roster.textContent).toContain('BH');
    expect(roster.textContent).not.toContain('CH');
    expect(roster.textContent).toMatch(/\+1/);
  });

  it('opens the phase stepper as a sheet from the title control', () => {
    renderBar();
    fireEvent.click(screen.getByTestId('canvas-app-bar-stage'));
    expect(screen.getByTestId('canvas-stage-sheet')).toBeInTheDocument();
  });

  /** Without a canvas around it the sheet still draws — every step simply reads Ready. */
  it('opens the sheet without a phase provider', () => {
    renderBar({ phase: 'make' });
    fireEvent.click(screen.getByTestId('canvas-app-bar-stage'));
    const sheet = screen.getByTestId('canvas-stage-sheet');
    expect(within(sheet).getByRole('tab', { name: 'Make, Now' })).toHaveAttribute('aria-selected', 'true');
    expect(within(sheet).getByRole('tab', { name: 'Run, Ready' })).not.toHaveAttribute('data-ready');
  });

  /**
   * THE PHONE'S READING OF READINESS (PRD 32 · W3/W13): each row of the sheet says its
   * state in words and what the phase adds, because a phone sheet has the width for words
   * a floating card does not.
   */
  it('gives each phase row its status line and what it adds, inside a canvas', () => {
    const onPhaseChange = vi.fn();
    renderWithPhase(
      <CanvasPhoneAppBar
        title="Dog walking for towers"
        phase="idea"
        onPhaseChange={onPhaseChange}
        surface="graph"
        onSurfaceChange={vi.fn()}
        roster={faces}
        boardMenu={<button type="button">More session actions</button>}
      />,
      { phase: 'idea', signals: { hasIdea: true } },
    );
    fireEvent.click(screen.getByTestId('canvas-app-bar-stage'));
    const sheet = screen.getByTestId('canvas-stage-sheet');

    const idea = within(sheet).getByRole('tab', { name: 'Idea, Now' });
    expect(idea).toHaveTextContent('Now · adds Chat, Board, Ideas, Room');
    const make = within(sheet).getByRole('tab', { name: 'Make, Ready' });
    expect(make).toHaveAttribute('data-ready', 'true');
    expect(make).toHaveTextContent('Ready · adds App');
    // Run needs an app, which Make builds.
    const run = within(sheet).getByRole('tab', { name: 'Run, Needs Make' });
    expect(run).toHaveAttribute('data-ready', 'false');
    expect(run).toHaveAttribute('data-state', 'needs');
    expect(run).toHaveTextContent('Needs Make · adds Operate');
    expect(within(sheet).getByRole('tab', { name: 'Measure, Needs Make' })).toHaveTextContent('adds Insights');
    expect(within(sheet).getByRole('tab', { name: 'Reach, Needs Make' })).toHaveTextContent('adds Launch');

    // The lock is a sign, not a gate: an unready phase still switches.
    fireEvent.click(run);
    expect(onPhaseChange).toHaveBeenCalledWith('run');
  });

  it('marks a phase whose own output exists as done', () => {
    renderWithPhase(
      <CanvasPhoneAppBar title="T" phase="make" onPhaseChange={vi.fn()} surface="graph" onSurfaceChange={vi.fn()} roster={[]} boardMenu={null} />,
      { phase: 'make', signals: { hasIdea: true } },
    );
    fireEvent.click(screen.getByTestId('canvas-app-bar-stage'));
    const idea = within(screen.getByTestId('canvas-stage-sheet')).getByRole('tab', { name: 'Idea, Done' });
    expect(idea).toHaveAttribute('data-state', 'done');
  });
});

/** The phone's tab strip offers what the desktop card offers: the phase's surfaces (W13). */
describe('CanvasSurfaceStrip under a phase', () => {
  const offered = () => within(screen.getByTestId('canvas-surface-strip')).getAllByRole('button').map((button) => button.textContent?.trim());

  it('narrows to the phase: Idea has no App, Run adds Operate, Reach adds Launch', () => {
    const { rerenderWithPhase } = renderWithPhase(<CanvasSurfaceStrip surface="graph" onChange={vi.fn()} />, { phase: 'idea' });
    expect(offered()).toEqual(['Chat', 'Board', 'Ideas', 'Room']);
    rerenderWithPhase(<CanvasSurfaceStrip surface="graph" onChange={vi.fn()} />, { phase: 'run' });
    expect(offered()).toEqual(['Chat', 'Board', 'Ideas', 'Room', 'App', 'Operate']);
    rerenderWithPhase(<CanvasSurfaceStrip surface="graph" onChange={vi.fn()} />, { phase: 'reach' });
    expect(offered()).toEqual(['Chat', 'Board', 'Ideas', 'Room', 'App', 'Operate', 'Insights', 'Launch']);
  });

  it('draws an icon for every surface it offers, Operate and Launch included', () => {
    renderWithPhase(<CanvasSurfaceStrip surface="graph" onChange={vi.fn()} />, { phase: 'reach' });
    for (const button of within(screen.getByTestId('canvas-surface-strip')).getAllByRole('button')) {
      expect(button.querySelector('svg'), button.textContent ?? '').not.toBeNull();
    }
  });
});
