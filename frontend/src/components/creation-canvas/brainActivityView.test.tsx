import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { CreationNode } from './CreationNode';
import { BrainDock } from './BrainDock';

/**
 * The processing signal has to read the SAME on every Brain surface.
 *
 * The regression these cover: the dock transcript froze on "Thinking…" while its own
 * footer said "Churning…", and the Brain Object on the board narrated nothing at all,
 * so a running turn looked stalled out there.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  const inert = () => null;
  return {
    Handle: inert, NodeResizer: inert, Position: { Left: 'left', Right: 'right' },
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
  it('narrates the running turn inside the Brain Object instead of leaving it frozen', () => {
    const view = render(<CreationNode
      {...nodeProps}
      data={{
        kind: 'chat', title: 'Brain',
        messages: [{ role: 'user', content: 'Create a campaign, its workflow, and landing page' }],
        trace: [toolEvent], brainRunning: true, brainRunStartedAt: Date.now() - 5_000,
      }}
    />);

    const running = screen.getByText('Executing…').closest('div')!;
    expect(within(running).getByText('add object')).toBeInTheDocument();
    expect(running).toHaveTextContent(/\ds/);

    // Settling leaves the receipt on the Object, not a blank card.
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

    expect(screen.getByText(/Thought for \ds/)).toBeInTheDocument();
    expect(screen.getByText('1 actions')).toBeInTheDocument();
    // The newest reply is what the anchor shows — it is a preview of the latest turn.
    expect(screen.getByText('I created a new sales campaign.')).toBeInTheDocument();
  });

  it('says the same words in the dock transcript and the dock footer', () => {
    render(<BrainDock {...dockProps} trace={[toolEvent]} running runStartedAt={Date.now() - 5_000} />);

    // Once in the transcript's live node, once in the footer strip — never two
    // different vocabularies for the same moment.
    expect(screen.getAllByText(/Executing…/).length).toBeGreaterThan(1);
  });

  it('falls back to the rotating idle phrasing before any step is recorded', () => {
    render(<BrainDock {...dockProps} trace={[]} running runStartedAt={Date.now()} />);

    expect(screen.getAllByText('Thinking…').length).toBeGreaterThan(1);
  });
});
