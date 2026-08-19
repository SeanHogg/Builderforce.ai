import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import { CanvasNodePanel } from './CanvasNodePanel';
import type { CreationNodeData } from './types';

/** The advanced hint, verbatim from the catalog — it is a button now, not prose. */
const HINT = 'Show everything else about this object.';
const WIDEN = 'Show everything about this object';

/**
 * The anchored panel is deliberately SHORT — name, status, and one advanced field — and
 * it says so: "Show everything else about this object."
 *
 * That sentence was inert text. Somebody who opens Advanced looking for their object's
 * own settings — a dashboard's date range and its refresh, a dataset's import — was told
 * where those live and then left to find the door themselves, which is how the panel came
 * to be reported as a place you "can't configure the dashboard" from. The sentence is the
 * control now, and it takes the SAME route as the header icon rather than inventing a
 * second one.
 *
 * Both routes WIDEN this panel. They used to close it and open a separate full-height
 * rail on the far side of the board, which is the thing being guarded against here: the
 * object's settings must never end up somewhere that no longer points at its card.
 */

const dashboard: CreationNodeData = { kind: 'dashboard', title: 'Board update', status: 'AI draft' };

function renderPanel(overrides: { expanded?: boolean; onToggleExpanded?: () => void } = {}) {
  const onToggleExpanded = overrides.onToggleExpanded ?? vi.fn();
  render(<CanvasNodePanel
    panel="config"
    nodeId="dash"
    data={dashboard}
    anchor={{ x: 0, y: 0 }}
    messages={[]}
    editable
    onChange={vi.fn()}
    onClose={vi.fn()}
    expanded={overrides.expanded ?? false}
    onToggleExpanded={onToggleExpanded}
    onOpenSurface={vi.fn()}
  ><p>every setting</p></CanvasNodePanel>);
  return { onToggleExpanded };
}

describe('the anchored config panel', () => {
  it('keeps the pointer to the rest hidden until Advanced is on', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: HINT })).toBeNull();
  });

  it('widens from the hint that names what is missing', () => {
    const { onToggleExpanded } = renderPanel();

    fireEvent.click(screen.getByTestId('canvas-node-panel-advanced-dash'));
    fireEvent.click(screen.getByRole('button', { name: HINT }));

    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  /**
   * One route, not two: the header icon and the advanced hint are the same call, so the
   * rest of an object's settings cannot be reachable one way and dead the other.
   */
  it('takes the same route as the header icon', () => {
    const { onToggleExpanded } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: WIDEN }));
    fireEvent.click(screen.getByTestId('canvas-node-panel-advanced-dash'));
    fireEvent.click(screen.getByRole('button', { name: HINT }));

    expect(onToggleExpanded).toHaveBeenCalledTimes(2);
  });

  /**
   * Wide, the panel IS the inspector: it draws the whole body it was handed and drops the
   * compact field list rather than stacking one on top of the other. The compact panel's
   * Advanced switch goes with it — everything it was hiding is already on screen.
   */
  it('shows the object whole when it is wide, and nothing twice', () => {
    renderPanel({ expanded: true });

    expect(screen.getByText('every setting')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByTestId('canvas-node-panel-advanced-dash')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to the short panel' })).toBeInTheDocument();
  });

  /**
   * A click outside closes the short panel and NOT the wide one. The wide reading opens
   * file pickers and confirm dialogs that mount outside this element, and a popover that
   * vanished on the first of those would be unusable.
   */
  it('survives a click away while wide, and closes on one while short', () => {
    const onClose = vi.fn();
    const { rerender } = render(<CanvasNodePanel
      panel="config" nodeId="dash" data={dashboard} anchor={{ x: 0, y: 0 }} messages={[]} editable
      onChange={vi.fn()} onClose={onClose} expanded onToggleExpanded={vi.fn()} onOpenSurface={vi.fn()}
    ><p>every setting</p></CanvasNodePanel>);

    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();

    rerender(<CanvasNodePanel
      panel="config" nodeId="dash" data={dashboard} anchor={{ x: 0, y: 0 }} messages={[]} editable
      onChange={vi.fn()} onClose={onClose} expanded={false} onToggleExpanded={vi.fn()} onOpenSurface={vi.fn()}
    ><p>every setting</p></CanvasNodePanel>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
