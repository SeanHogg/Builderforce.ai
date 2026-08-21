import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalCreationSession, creationStorageKey, writeLocalCreationSession } from '@/domains/canvas/infrastructure/localCanvasStore';
import { CreationCanvas } from './CreationCanvas';

// No suite-level timeout override — see the note in `CreationCanvas.test.tsx`:
// the 15s cap was a mitigation for a render loop that no longer exists, and it
// now only cuts off heavy mounts when this file runs alongside the rest of
// `src/components` rather than on its own.
describe('CreationCanvas with the real XYFlow store', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('hydrates an anonymous local Session without an update-depth loop', async () => {
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args); });
    const sessionId = createLocalCreationSession('Build a new website');

    render(<CreationCanvas sessionId={sessionId} persistence="local" />);

    await waitFor(() => expect(screen.getAllByText('Build a new website').length).toBeGreaterThan(0));
    // The initial prompt auto-submits after hydration. Stay mounted through that
    // update as well; the production failure appeared after the first store sync.
    await new Promise((resolve) => window.setTimeout(resolve, 1_200));
    expect(errors.map((args) => args.join(' ')).join('\n')).not.toMatch(/maximum update depth|error #185/i);
  });

  /**
   * A CARD MUST SURVIVE A BOARD UPDATE.
   *
   * `updateNodeData` is handed to every card through the `nodeTypes` memo, and it used
   * to list `nodes` as a dependency. `nodes` changes identity on every board event —
   * a selection, a drag, a re-measure, each streamed Brain token writing the transcript
   * back onto the chat Object — so React Flow received a new `nodeTypes` object
   * continuously and remounted every Object on the board, destroying whatever local
   * state a card was holding.
   *
   * Reported as "Edit dashboard does nothing": the remount lands between the mousedown
   * that SELECTS a card and the click on a control inside it, so the first press hit an
   * element that no longer existed, and any editor that did open closed again on the
   * next board event.
   *
   * The assertion is on the DOM node's IDENTITY rather than on the editor being visible,
   * because identity is the actual invariant — a remounted card can look identical and
   * still have thrown away every piece of state inside it. This must hold for the real
   * store; the mocked-XYFlow suites cannot see it.
   */
  it('keeps every card mounted across a board update', async () => {
    const sessionId = createLocalCreationSession('A board with a dashboard on it');
    const stored = JSON.parse(localStorage.getItem(creationStorageKey(sessionId))!);
    writeLocalCreationSession(sessionId, {
      ...stored,
      nodes: [
        ...stored.nodes,
        { id: 'dash', type: 'creation', position: { x: 600, y: 120 }, data: { kind: 'dashboard', title: 'Board update' } },
        { id: 'note', type: 'creation', position: { x: 600, y: 460 }, data: { kind: 'note', title: 'A note' } },
      ],
    });

    render(<CreationCanvas sessionId={sessionId} persistence="local" />);

    const dashboard = await screen.findByTestId('canvas-node-dashboard');
    // The card is EDITABLE, which is the precondition for it holding the state a remount
    // destroys: this toggle and the dashboard's own "Edit dashboard" button render on the
    // same `onEditData` condition. Asserted by test id rather than by accessible name
    // because this file runs against the key-echoing intl mock, not the real catalog.
    expect(screen.getByTestId('canvas-node-density-dash')).toBeInTheDocument();

    // A board mutation on a DIFFERENT card: the density toggle rewrites `nodes`, which
    // is exactly the event that used to re-create `nodeTypes`.
    fireEvent.click(screen.getByTestId('canvas-node-density-note'));

    await waitFor(() => expect(screen.getByTestId('canvas-node-note')).toHaveAttribute('data-density', 'preview'));
    expect(screen.getByTestId('canvas-node-dashboard')).toBe(dashboard);
  });
});
