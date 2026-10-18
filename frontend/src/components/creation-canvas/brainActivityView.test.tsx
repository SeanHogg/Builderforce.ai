import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BrainRunActivity, BrainTraceEvent, RunKey } from '@seanhogg/builderforce-brain-embedded';
import { CreationNode } from './CreationNode';
import { BrainDock } from './BrainDock';

/**
 * Every Brain surface on the canvas narrates a run with THE shared live row
 * (`LiveActivity`, brain-ui), read off the run store's `activity` — the same reading the
 * panel and VS Code animate. The canvas used to keep a second narrator of its own that
 * re-derived phase words from the SETTLED trace, so it could only name a step after it
 * had finished, and spoke a different vocabulary from every other host.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

/** The run store's in-flight step for {@link RUN_KEY}, as a test sets it. */
const RUN_KEY = 'canvas:activity-test';
const live = vi.hoisted(() => ({ activity: null as BrainRunActivity | null }));
vi.mock('@seanhogg/builderforce-brain-embedded', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seanhogg/builderforce-brain-embedded')>();
  return {
    ...actual,
    useRunSnapshot: (key: RunKey | null) => {
      const snapshot = actual.useRunSnapshot(key);
      return key === RUN_KEY && live.activity ? { ...snapshot, activity: live.activity } : snapshot;
    },
  };
});

vi.mock('@xyflow/react', async () => {
  const inert = () => null;
  return {
    Handle: inert, useNodeId: () => 'node', NodeResizer: inert, Position: { Left: 'left', Right: 'right' },
    // An empty board: the Brain Object here has been given no authored size.
    useStore: (selector: (state: { nodeLookup: Map<string, unknown> }) => unknown) => selector({ nodeLookup: new Map() }),
  };
});

const nodeProps = {
  id: 'brain-object', type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
  selectable: true, deletable: true, draggable: true, isConnectable: true,
  positionAbsoluteX: 0, positionAbsoluteY: 0,
};

const toolEvent: BrainTraceEvent = { ts: '2026-08-05T00:00:00.000Z', category: 'tool', label: 'canvas.add_object' };

const dockProps = {
  mode: 'docked' as const, side: 'right' as const, size: 'slim' as const, width: 330,
  showExecutionDetail: false,
  onModeChange: vi.fn(), onSideChange: vi.fn(), onSizeChange: vi.fn(), onWidthChange: vi.fn(),
  onExecutionDetailChange: vi.fn(), onClose: vi.fn(),
  messages: [], node: null, nodes: [], edges: [],
};

describe('Brain activity signal', () => {
  it('narrates a running turn inside the Brain Object with the shared live row', () => {
    const view = render(<CreationNode
      {...nodeProps}
      data={{
        kind: 'chat', title: 'Brain',
        messages: [{ role: 'user', content: 'Create a campaign, its workflow, and landing page' }],
        trace: [toolEvent], brainRunning: true, brainRunStartedAt: Date.now() - 5_000,
      }}
    />);

    // A run with no entry in this browser's run store (a collaborator's turn, mirrored
    // onto the board) still reads as alive, from the start time the board carries.
    const running = screen.getByTestId('canvas-run-activity');
    expect(within(running).getByLabelText('Current activity')).toHaveTextContent('Thinking…');
    expect(running).toHaveTextContent(/\ds/);

    // Settled, the anchor shows the newest reply — a preview of the latest turn.
    view.rerender(<CreationNode
      {...nodeProps}
      data={{
        kind: 'chat', title: 'Brain',
        messages: [
          { role: 'user', content: 'Create a campaign, its workflow, and landing page' },
          { role: 'assistant', content: 'I created a new sales campaign.' },
        ],
        trace: [toolEvent], brainRunning: false, brainRunStartedAt: Date.now() - 5_000,
      }}
    />);

    expect(screen.queryByTestId('canvas-run-activity')).toBeNull();
    expect(screen.getByText('I created a new sales campaign.')).toBeInTheDocument();
  });

  it('names the step the run store says is in flight, once, in the dock transcript', () => {
    live.activity = { phase: 'tool', label: 'canvas.add_object', startedAt: Date.now() - 3_000, step: 2 };
    try {
      const { container } = render(<BrainDock {...dockProps} trace={[toolEvent]} running runKey={RUN_KEY} runStartedAt={Date.now() - 5_000} />);

      // The transcript's live row is the one reading of the run in the dock — no second
      // strip above the prompt saying the same moment again.
      expect(screen.getByLabelText('Current activity')).toHaveTextContent('Running canvas.add_object');
      expect(screen.getByText('step 2')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="canvas-run-activity"]')).toBeNull();
    } finally {
      live.activity = null;
    }
  });

  it('falls back to the shared opening phrasing before the run publishes a step', () => {
    render(<BrainDock {...dockProps} trace={[]} running />);

    expect(screen.getByLabelText('Current activity')).toHaveTextContent('Starting…');
  });
});
