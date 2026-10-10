import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PaneLayer } from './PaneLayer';

describe('PaneLayer', () => {
  afterEach(() => cleanup());

  it('hides an inactive layer and takes it out of pointer hit-testing', () => {
    render(<PaneLayer active={false}><span>pane</span></PaneLayer>);
    const layer = screen.getByText('pane').parentElement!;
    expect(layer.style.visibility).toBe('hidden');
    expect(layer.style.pointerEvents).toBe('none');
  });

  // A canvas board kept mounted behind another (`CanvasStage`) is hidden by an ancestor's
  // `visibility:hidden`. An active layer that asserted `visible`/`auto` beat that and painted
  // the hidden board's App preview over the board on stage.
  it('lets an active layer inherit visibility and pointer-events from its ancestors', () => {
    render(
      <div style={{ visibility: 'hidden', pointerEvents: 'none' }}>
        <PaneLayer active><span>pane</span></PaneLayer>
      </div>,
    );
    const layer = screen.getByText('pane').parentElement!;
    expect(layer.style.visibility).toBe('');
    expect(layer.style.pointerEvents).toBe('');
  });
});
