import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ALL_SIGNALS, renderWithPhase } from './testPhaseProvider';
import { CanvasPhasePath } from './CanvasPhasePath';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

/**
 * THE PATH (PRD 32 · W7): pressing a phase the board is not ready for says what is
 * missing and the shortest way there — never a lock, never a blank.
 */
const path = () => screen.queryByTestId('canvas-phase-path');
const steps = () => screen.queryAllByTestId('canvas-phase-path-step');

describe('CanvasPhasePath', () => {
  it('says nothing when the phase is ready and nothing is advised', () => {
    renderWithPhase(<CanvasPhasePath />, { phase: 'idea' });
    expect(path()).toBeNull();
  });

  it('says nothing in a ready Measure', () => {
    renderWithPhase(<CanvasPhasePath />, { phase: 'measure', signals: { hasIdea: true, hasApp: true, isLive: true } });
    expect(path()).toBeNull();
  });

  it('says nothing in a Reach with everything, metric included', () => {
    renderWithPhase(<CanvasPhasePath />, { phase: 'reach', signals: ALL_SIGNALS });
    expect(path()).toBeNull();
  });

  it('says nothing outside a canvas', () => {
    render(<CanvasPhasePath />);
    expect(path()).toBeNull();
  });

  it('numbers one step per missing requirement, in arc order', () => {
    renderWithPhase(<CanvasPhasePath />, { phase: 'measure', signals: {} });
    expect(path()).toHaveAttribute('role', 'status');
    expect(path()).toHaveAttribute('data-stage', 'measure');
    expect(steps().map((step) => step.querySelector('span')?.textContent)).toEqual([
      'An idea on the board',
      'An app built from it',
      'A live app — a deployment with an address',
    ]);
    expect(screen.getByText('Measure · 3 steps away')).toBeInTheDocument();
    expect(screen.getByText('Put the app live before you measure it')).toBeInTheDocument();
  });

  it('counts one step with the singular', () => {
    renderWithPhase(<CanvasPhasePath />, { phase: 'measure', signals: { hasIdea: true, hasApp: true } });
    expect(steps()).toHaveLength(1);
    expect(screen.getByText('Measure · 1 step away')).toBeInTheDocument();
  });

  it('gives only the FIRST step its two presses', () => {
    renderWithPhase(<CanvasPhasePath />, { phase: 'run', signals: {} });
    const [first, second] = steps();
    expect(within(first!).getAllByRole('button')).toHaveLength(2);
    expect(within(second!).queryAllByRole('button')).toHaveLength(0);
  });

  it('"Go to" moves the canvas to the phase that satisfies the first missing requirement', () => {
    const { setPhase } = renderWithPhase(<CanvasPhasePath />, { phase: 'measure', signals: { hasIdea: true } });
    // Missing: app (Make), live (Run) — the first is Make.
    fireEvent.click(screen.getByRole('button', { name: 'Go to Make' }));
    expect(setPhase).toHaveBeenCalledWith('make');
  });

  it('"Let Brain" asks Brain for the first missing requirement, through the one turn door', () => {
    const { askBrain } = renderWithPhase(<CanvasPhasePath />, { phase: 'measure', signals: { hasIdea: true, hasApp: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Let Brain deploy it' }));
    expect(askBrain).toHaveBeenCalledTimes(1);
    expect(askBrain).toHaveBeenCalledWith('Deploy this canvas’s app and record the deployment on the board with its address.');
  });

  it('folds to its kicker and opens again — in memory only', () => {
    renderWithPhase(<CanvasPhasePath />, { phase: 'make', signals: {} });
    const fold = screen.getByRole('button', { name: 'Fold this away' });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(path()).toHaveAttribute('data-collapsed', 'false');

    fireEvent.click(fold);
    expect(path()).toHaveAttribute('data-collapsed', 'true');
    expect(steps()).toHaveLength(0);
    // The kicker stays: the chip still says how far away the phase is.
    expect(screen.getByText('Make · 1 step away')).toBeInTheDocument();
    const unfold = screen.getByRole('button', { name: 'Show what is missing' });
    expect(unfold).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(unfold);
    expect(steps()).toHaveLength(1);
    // Never persisted: a returning reader always sees what is still missing.
    expect(Object.keys(window.localStorage).filter((key) => key.includes('phasePath'))).toEqual([]);
  });

  it('warns, in one line, when Reach goes out with nothing measured — and still lets it', () => {
    const { setPhase } = renderWithPhase(<CanvasPhasePath />, { phase: 'reach', signals: { hasIdea: true, hasApp: true, isLive: true } });
    expect(path()).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText('Nothing here is measured yet — reaching people without a metric is spending blind.')).toBeInTheDocument();
    expect(steps()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Measure' }));
    expect(setPhase).toHaveBeenCalledWith('measure');
  });
});
