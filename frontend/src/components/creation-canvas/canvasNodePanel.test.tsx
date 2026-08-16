import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import { CanvasNodePanel } from './CanvasNodePanel';
import type { CreationNodeData } from './types';

/** The advanced hint, verbatim from the catalog — it is a button now, not prose. */
const HINT = 'Everything else about this object lives in the full inspector.';

/**
 * The anchored panel is deliberately SHORT — name, status, and one advanced field —
 * and it says so: "Everything else about this object lives in the full inspector."
 *
 * That sentence was inert text. Somebody who opens Advanced looking for their object's
 * own settings — a dashboard's date range and its refresh, a dataset's import — was told
 * where those live and then left to find the door themselves, which is how the panel came
 * to be reported as a place you "can't configure the dashboard" from. The sentence is the
 * door now, and it takes the SAME route as the header icon rather than inventing a
 * second one.
 */

const dashboard: CreationNodeData = { kind: 'dashboard', title: 'Board update', status: 'AI draft' };

function renderPanel(overrides: { onOpenFull?: () => void } = {}) {
  const onOpenFull = overrides.onOpenFull ?? vi.fn();
  render(<CanvasNodePanel
    panel="config"
    nodeId="dash"
    data={dashboard}
    anchor={{ x: 0, y: 0 }}
    messages={[]}
    editable
    onChange={vi.fn()}
    onClose={vi.fn()}
    onOpenFull={onOpenFull}
  />);
  return { onOpenFull };
}

describe('the anchored config panel', () => {
  it('keeps the inspector pointer hidden until Advanced is on', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: HINT })).toBeNull();
  });

  it('opens the full inspector from the hint that names it', () => {
    const { onOpenFull } = renderPanel();

    fireEvent.click(screen.getByTestId('canvas-node-panel-advanced-dash'));
    fireEvent.click(screen.getByRole('button', { name: HINT }));

    expect(onOpenFull).toHaveBeenCalledTimes(1);
  });

  /**
   * One route, not two: the header icon and the advanced hint are the same call, so the
   * inspector cannot open one way and be dead the other.
   */
  it('takes the same route as the header icon', () => {
    const { onOpenFull } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Open the full inspector' }));
    fireEvent.click(screen.getByTestId('canvas-node-panel-advanced-dash'));
    fireEvent.click(screen.getByRole('button', { name: HINT }));

    expect(onOpenFull).toHaveBeenCalledTimes(2);
  });
});
