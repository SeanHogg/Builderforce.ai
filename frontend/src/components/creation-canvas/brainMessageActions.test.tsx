import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { BrainDock } from './BrainDock';

/**
 * Per-message Copy and "Send again" belong to the SHARED transcript.
 *
 * The regression these lock down: the actions used to live in the web Brain panel's
 * own action bar, so the Canvas dock — the surface in the screenshot — had none at
 * all, on either role. They now come from <BrainTimeline>, which every surface
 * mounts, and they appear on the user's turn as well as the reply.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

vi.mock('@xyflow/react', async () => {
  const inert = () => null;
  return {
    Handle: inert, NodeResizer: inert, Position: { Left: 'left', Right: 'right' },
    useStore: (selector: (state: { nodeLookup: Map<string, unknown> }) => unknown) => selector({ nodeLookup: new Map() }),
  };
});

const message = (id: number, role: string, content: string): BrainMessage => ({
  id, seq: id, role, content, metadata: null, createdAt: '2026-08-12T00:00:00.000Z',
});

const messages = [
  message(1, 'user', 'add standard SaaS metrics'),
  message(2, 'assistant', 'I added a SaaS Metrics Dashboard.'),
];

const dockProps = {
  mode: 'docked' as const, side: 'right' as const, size: 'slim' as const, width: 330,
  showExecutionDetail: false,
  onModeChange: vi.fn(), onSideChange: vi.fn(), onSizeChange: vi.fn(), onWidthChange: vi.fn(),
  onExecutionDetailChange: vi.fn(), onClose: vi.fn(),
  messages, trace: [], running: false, node: null, nodes: [], edges: [],
};

describe('Brain transcript message actions', () => {
  it('puts Copy and Send again on BOTH the user turn and the reply', () => {
    render(<BrainDock {...dockProps} onReplayMessage={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Send again' })).toHaveLength(2);
  });

  it('replays the message it was clicked on, with its role', () => {
    const onReplayMessage = vi.fn();
    render(<BrainDock {...dockProps} onReplayMessage={onReplayMessage} />);

    const [userReplay, assistantReplay] = screen.getAllByRole('button', { name: 'Send again' });
    fireEvent.click(userReplay!);
    expect(onReplayMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'add standard SaaS metrics' }), 'user');

    fireEvent.click(assistantReplay!);
    expect(onReplayMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'I added a SaaS Metrics Dashboard.' }),
      'assistant',
    );
  });

  it('copies the message text and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<BrainDock {...dockProps} onReplayMessage={vi.fn()} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]!);
    expect(writeText).toHaveBeenCalledWith('add standard SaaS metrics');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  /** A transcript nobody can drive offers only what it can honour. */
  it('hides Send again when the surface cannot send, and still offers Copy', () => {
    render(<BrainDock {...dockProps} />);

    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });
});
