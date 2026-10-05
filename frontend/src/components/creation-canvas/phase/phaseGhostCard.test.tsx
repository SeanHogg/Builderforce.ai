import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { GHOST_CARD_GAP, GHOST_CARD_WIDTH } from '@/lib/canvasPhaseLens';
import { CanvasDockInsetsContext } from '../stage/canvasDockInsets';
import { CanvasSurfaceProvider } from '../canvasSurfaceContext';
import { ALL_SIGNALS, renderWithPhase } from './testPhaseProvider';
import { PhaseGhostCard } from './PhaseGhostCard';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

/**
 * The React Flow store, as the ghost reads it: the board's nodes, the pane size and the
 * transform. Mocked because the ghost is drawn in FLOW coordinates through a portal that
 * only exists inside a mounted `<ReactFlow>` — what is under test is the decision of
 * whether and where, not React Flow's portal.
 */
type FlowNode = { position: { x: number; y: number }; measured?: { width?: number; height?: number }; data?: { kind?: unknown } };
const flow = vi.hoisted(() => ({
  state: { nodeLookup: new Map<string, FlowNode>(), width: 1000, height: 600, transform: [0, 0, 1] as [number, number, number] },
}));
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useStore: (selector: (state: typeof flow.state) => unknown) => selector(flow.state),
  ViewportPortal: ({ children }: { children: ReactNode }) => <div data-testid="viewport-portal">{children}</div>,
}));

// `usePhoneViewport` is `false` in jsdom by design; the phone case has to be driven.
const viewport = vi.hoisted(() => ({ phone: false }));
vi.mock('@/lib/usePhoneViewport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/usePhoneViewport')>()),
  usePhoneViewport: () => viewport.phone,
}));

const ghost = () => screen.queryByTestId('canvas-phase-ghost');
const setBoard = (nodes: Record<string, FlowNode>) => { flow.state.nodeLookup = new Map(Object.entries(nodes)); };

describe('PhaseGhostCard — where the phase\'s first object would go', () => {
  beforeEach(() => {
    window.localStorage.clear();
    viewport.phone = false;
    setBoard({});
    flow.state.transform = [0, 0, 1];
    flow.state.width = 1000;
  });

  describe('visibility', () => {
    it('draws on an empty board in a ready phase', () => {
      renderWithPhase(<PhaseGhostCard />, { phase: 'idea' });
      expect(ghost()).toBeInTheDocument();
      expect(ghost()).toHaveAttribute('data-ready', 'true');
    });

    it('draws when the board holds only cards the phase is NOT about', () => {
      setBoard({ n: { position: { x: 0, y: 0 }, data: { kind: 'note' } } });
      renderWithPhase(<PhaseGhostCard />, { phase: 'measure', signals: ALL_SIGNALS });
      expect(ghost()).toBeInTheDocument();
    });

    it('draws nothing once a card the phase brings forward exists', () => {
      setBoard({ n: { position: { x: 0, y: 0 }, data: { kind: 'note' } }, k: { position: { x: 300, y: 0 }, data: { kind: 'kpi' } } });
      renderWithPhase(<PhaseGhostCard />, { phase: 'measure', signals: ALL_SIGNALS });
      expect(ghost()).toBeNull();
    });

    it('draws nothing when the lens is off', () => {
      window.localStorage.setItem('builderforce:create:phaseFocus', 'false');
      renderWithPhase(<PhaseGhostCard />, { phase: 'idea' });
      expect(ghost()).toBeNull();
    });

    it('draws nothing on a phone — the path card covers it there', () => {
      viewport.phone = true;
      renderWithPhase(<PhaseGhostCard />, { phase: 'idea' });
      expect(ghost()).toBeNull();
    });

    it('draws nothing when the board is not what is on screen', () => {
      renderWithPhase(<CanvasSurfaceProvider value="chat"><PhaseGhostCard /></CanvasSurfaceProvider>, { phase: 'idea' });
      expect(ghost()).toBeNull();
    });

    it('draws nothing outside a canvas', () => {
      render(<PhaseGhostCard />);
      expect(ghost()).toBeNull();
    });
  });

  describe('position', () => {
    it('stands at the viewport centre of an empty board', () => {
      flow.state.transform = [100, 50, 2];
      renderWithPhase(<PhaseGhostCard />, { phase: 'idea' });
      // Centre in flow space: ((1000/2 - 100) / 2, (600/2 - 50) / 2) = (200, 125).
      expect(ghost()!.style.transform).toBe(`translate(${200 - GHOST_CARD_WIDTH / 2}px, ${125 - 60}px)`);
    });

    it('stands just right of the board, top-aligned with it', () => {
      setBoard({
        a: { position: { x: 0, y: 80 }, measured: { width: 300 }, data: { kind: 'note' } },
        b: { position: { x: 500, y: 20 }, data: { kind: 'note' } },
      });
      flow.state.width = 2000;
      renderWithPhase(<PhaseGhostCard />, { phase: 'idea' });
      expect(ghost()!.style.transform).toBe(`translate(${500 + GHOST_CARD_WIDTH + GHOST_CARD_GAP}px, 20px)`);
    });

    it('drops under the board when the slot beside it is past the pane edge', () => {
      setBoard({
        a: { position: { x: 0, y: 80 }, measured: { width: 300, height: 100 }, data: { kind: 'note' } },
        b: { position: { x: 500, y: 20 }, measured: { width: 260, height: 140 }, data: { kind: 'note' } },
      });
      renderWithPhase(<PhaseGhostCard />, { phase: 'idea' });
      // Pane is 1000 wide; beside would be 840..1100. Under: left 0, bottom max(180, 160) + gap.
      expect(ghost()!.style.transform).toBe(`translate(0px, ${180 + GHOST_CARD_GAP}px)`);
    });

    it('treats the pane under a docked Brain as off screen', () => {
      // Beside the board is 340..600 — inside a 1000px pane, but under a 500px right dock.
      setBoard({ a: { position: { x: 0, y: 0 }, measured: { width: 260, height: 100 }, data: { kind: 'note' } } });
      renderWithPhase(
        <CanvasDockInsetsContext.Provider value={{ left: 0, right: 500 }}><PhaseGhostCard /></CanvasDockInsetsContext.Provider>,
        { phase: 'idea' },
      );
      expect(ghost()!.style.transform).toBe(`translate(0px, ${100 + GHOST_CARD_GAP}px)`);
    });
  });

  describe('content', () => {
    it('offers Brain and a hand-add in a READY phase', () => {
      const { askBrain, appendAtCenter } = renderWithPhase(<PhaseGhostCard />, { phase: 'idea' });
      expect(ghost()).toHaveAccessibleName('Where the first Idea object goes');
      expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
      expect(screen.getByText('Add the first Idea object')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Let Brain capture an idea' }));
      expect(askBrain).toHaveBeenCalledWith('Capture my idea as an idea card: the problem, who has it, and the riskiest assumption.');

      fireEvent.click(screen.getByRole('button', { name: 'Add Idea' }));
      expect(appendAtCenter).toHaveBeenCalledWith('idea');
    });

    it('names what is missing in an UNREADY phase, and asks Brain for that instead', () => {
      // Measure on a board with an idea and an app but nothing live.
      const { askBrain } = renderWithPhase(<PhaseGhostCard />, { phase: 'measure', signals: { hasIdea: true, hasApp: true } });
      expect(ghost()).toHaveAttribute('data-ready', 'false');
      expect(screen.getByText('Not yet · needs Run')).toBeInTheDocument();
      expect(screen.getByText('Put the app live before you measure it')).toBeInTheDocument();
      // No hand-add: the phase's own first object is not the next step yet.
      expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Let Brain deploy it' }));
      expect(askBrain).toHaveBeenCalledWith('Deploy this canvas’s app and record the deployment on the board with its address.');
    });

    it('names the FIRST missing requirement when several are', () => {
      renderWithPhase(<PhaseGhostCard />, { phase: 'reach', signals: {} });
      expect(screen.getByText('Not yet · needs Idea')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Let Brain capture it' })).toBeInTheDocument();
    });

    it('offers no hand-add to a viewer who cannot edit', () => {
      renderWithPhase(<PhaseGhostCard />, { phase: 'idea', appendAtCenter: null });
      expect(screen.getByRole('button', { name: 'Let Brain capture an idea' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add Idea' })).toBeNull();
    });
  });
});
