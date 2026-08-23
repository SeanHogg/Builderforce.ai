import { useEffect, useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActiveCanvasProvider, useOptionalActiveCanvas, type ActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { panelOpen } from '@/lib/workbenchPolicy';

/**
 * PRD 21 §6.1 — "Opening any authenticated destination does **not** unmount the
 * canvas… Asserted by test, not by eye."
 *
 * The mechanism is structural: the stage keeps its POSITION in the tree across
 * the route change, so React preserves the instance. What can break it is not
 * the stage — it is somebody later moving it into the branch that swaps, at
 * which point the board (and the in-flight agent turn on it) is thrown away on
 * every navigation and nothing fails.
 *
 * So this renders a stand-in board at the position `AppShell` puts the real one,
 * navigates from a stage route to a panel route, and asserts the instance was
 * never re-created — plus that the policy says "panel", because a destination
 * that classified as standalone would legitimately replace the screen.
 */

const board: ActiveCanvas = {
  sessionId: 'c_1',
  persistence: 'server',
  focusId: null,
  shareOpen: false,
  buildOpen: false,
  buildChatId: null,
  buildTicket: null,
  prompt: null,
  present: false,
  modelComparisonIds: [],
};

/** Counts its own mounts — one mount for the whole test is the whole assertion. */
function StandInBoard({ onMount }: { onMount: () => void }) {
  const turns = useRef(0);
  useEffect(() => { onMount(); }, [onMount]);
  // Board-local state stands for the in-flight agent turn / viewport / presence
  // that §6.1 says must survive. A remount would reset it to zero.
  turns.current += 1;
  return <output>{`mounted-${board.sessionId}`}</output>;
}

/** The shape `AppShell` renders: the stage first, the route beside it. */
function Shell({ pathname, onMount }: { pathname: string; onMount: () => void }) {
  const canvas = useOptionalActiveCanvas()!;
  useEffect(() => { canvas.open(board); }, [canvas]);
  if (canvas.active == null) return null;

  const asPanel = panelOpen(pathname);
  return (
    <div>
      <StandInBoard onMount={onMount} />
      {asPanel ? <div role="dialog">panel: {pathname}</div> : <div>{pathname}</div>}
    </div>
  );
}

describe('PRD 21 §6.1 — the stage survives a navigation', () => {
  it('keeps ONE board instance when a destination opens over it', () => {
    const onMount = vi.fn();
    const { rerender } = render(
      <ActiveCanvasProvider stageHosted><Shell pathname="/create/c_1" onMount={onMount} /></ActiveCanvasProvider>,
    );
    expect(screen.getByText('mounted-c_1')).toBeInTheDocument();
    expect(onMount).toHaveBeenCalledTimes(1);

    // Navigate to an authenticated destination — the case §6.1 is about.
    rerender(
      <ActiveCanvasProvider stageHosted><Shell pathname="/settings" onMount={onMount} /></ActiveCanvasProvider>,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('panel: /settings');
    // Still one mount: the board was kept, not rebuilt.
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(screen.getByText('mounted-c_1')).toBeInTheDocument();

    // …and back again, without a remount either way.
    rerender(
      <ActiveCanvasProvider stageHosted><Shell pathname="/create/c_1" onMount={onMount} /></ActiveCanvasProvider>,
    );
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('classifies the destinations this rule is about as panels, not replacements', () => {
    for (const route of ['/settings', '/workforce', '/insights/delivery', '/quality', '/knowledge']) {
      expect(panelOpen(route)).toBe(true);
    }
    expect(panelOpen('/projects/7')).toBe(false);
  });
});
