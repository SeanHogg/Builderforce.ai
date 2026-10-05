import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ReactFlowProvider, type Edge } from '@xyflow/react';
import type { CanvasPhase } from '@/lib/canvasPhases';
import { CANVAS_PHASES } from '@/lib/canvasPhases';
import { GHOST_CARD_GAP, GHOST_CARD_WIDTH, PHASE_FOCUS_KINDS, ghostPosition, phaseFirstKind, phaseFocusOf } from '@/lib/canvasPhaseLens';
import type { CreationNodeData } from './types';
import { CREATION_OBJECT_REGISTRY } from './creationObjectRegistry';
import { PhaseFocusToggle } from './phase/PhaseFocusToggle';
import { usePhaseLensEdges } from './phase/usePhaseLensEdges';
import { PhaseHarness, renderWithPhase } from './phase/testPhaseProvider';
import styles from './CreationCanvas.module.css';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const { CreationNode } = await import('./CreationNode');

/**
 * THE BOARD LENS (PRD 32 · W5). A phase is a way of reading the same board: the kinds it
 * is about come forward (`data-phase-focus="in"`), the rest recede (`out`), frames are
 * structure and never dimmed, and the whole thing switches off from the ••• menu.
 */

function node(id: string, data: Record<string, unknown>, selected = false) {
  return (
    <CreationNode
      id={id}
      type="creation"
      data={data as unknown as CreationNodeData}
      selected={selected}
      dragging={false}
      zIndex={1}
      isConnectable={false}
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      draggable={false}
      selectable={false}
      deletable={false}
    />
  );
}

const website = { kind: 'website', title: 'GreenEdge Yard Care', pages: [] };
const scribble = { kind: 'note', title: 'Quick note' };
const frame = { kind: 'frame', title: 'Launch week' };

const focusOf = (id: string) => document.querySelector(`[data-node-id="${id}"]`)?.getAttribute('data-phase-focus') ?? null;

describe('the lens is data, checked against the registry', () => {
  /** A renamed kind would otherwise dim its cards forever, silently. */
  it('names only kinds the object registry declares', () => {
    const registered = new Set(CREATION_OBJECT_REGISTRY.map((definition) => definition.kind as string));
    for (const phase of CANVAS_PHASES) {
      expect(PHASE_FOCUS_KINDS[phase].length, phase).toBeGreaterThan(0);
      for (const kind of PHASE_FOCUS_KINDS[phase]) expect(registered.has(kind), `${phase}: ${kind} is not a registered kind`).toBe(true);
    }
  });

  it('reads a kind as in for its phase, out elsewhere, and never dims a frame', () => {
    expect(phaseFocusOf('kpi', 'measure')).toBe('in');
    expect(phaseFocusOf('kpi', 'make')).toBe('out');
    expect(phaseFocusOf('deployment', 'run')).toBe('in');
    // `experiment` serves two phases: testing demand (Idea) and reading results (Measure).
    expect(phaseFocusOf('experiment', 'idea')).toBe('in');
    expect(phaseFocusOf('experiment', 'measure')).toBe('in');
    // A kind in no row is out everywhere — dimmed, never hidden.
    for (const phase of CANVAS_PHASES) expect(phaseFocusOf('note', phase)).toBe('out');
    for (const phase of CANVAS_PHASES) expect(phaseFocusOf('frame', phase)).toBeNull();
  });

  it('adds the first kind of each phase from the ghost card', () => {
    for (const phase of CANVAS_PHASES) expect(phaseFirstKind(phase)).toBe(PHASE_FOCUS_KINDS[phase][0]);
    expect(phaseFirstKind('idea')).toBe('idea');
  });
});

describe('CreationNode under the lens', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const board = (phase: CanvasPhase, children: ReactNode) => renderWithPhase(<ReactFlowProvider>{children}</ReactFlowProvider>, { phase });

  it('marks an in-kind card in and an out-kind card out', () => {
    board('make', <>{node('site', website)}{node('note', scribble)}</>);
    expect(focusOf('site')).toBe('in');
    expect(focusOf('note')).toBe('out');
  });

  it('re-reads the same card when the phase changes', () => {
    const { rerenderWithPhase } = board('make', node('site', website));
    expect(focusOf('site')).toBe('in');
    rerenderWithPhase(<ReactFlowProvider>{node('site', website)}</ReactFlowProvider>, { phase: 'measure' });
    expect(focusOf('site')).toBe('out');
  });

  it('marks the minimised orb too — the other root', () => {
    board('make', node('orb', { ...scribble, density: 'minimized' }));
    const orb = document.querySelector('[data-node-id="orb"]')!;
    expect(orb).toHaveAttribute('data-density', 'minimized');
    expect(orb).toHaveAttribute('data-phase-focus', 'out');
  });

  /** The stylesheet keeps a selected card at full strength; the attribute stays so the
   *  card dims again the moment it is deselected. */
  it('keeps the attribute on a selected out card, beside the selected class', () => {
    board('make', node('picked', scribble, true));
    const card = document.querySelector('[data-node-id="picked"]')!;
    expect(card).toHaveAttribute('data-phase-focus', 'out');
    if (styles.selected) expect(card.className).toContain(styles.selected);
  });

  it('never marks a frame', () => {
    board('make', node('frame', frame));
    expect(document.querySelector('[data-node-id="frame"]')).toBeInTheDocument();
    expect(focusOf('frame')).toBeNull();
  });

  it('draws no attribute outside a canvas', () => {
    render(<ReactFlowProvider>{node('site', website)}</ReactFlowProvider>);
    expect(document.querySelector('[data-node-id="site"]')).toBeInTheDocument();
    expect(focusOf('site')).toBeNull();
  });

  it('switches off from the Phase focus toggle, and remembers it', () => {
    board('make', <><PhaseFocusToggle />{node('site', website)}{node('note', scribble)}</>);
    const toggle = screen.getByTestId('canvas-phase-focus-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName('Phase focus');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(focusOf('site')).toBeNull();
    expect(focusOf('note')).toBeNull();
    expect(window.localStorage.getItem('builderforce:create:phaseFocus')).toBe('false');

    fireEvent.click(toggle);
    expect(focusOf('site')).toBe('in');
  });

  it('starts off when the preference was stored off', () => {
    window.localStorage.setItem('builderforce:create:phaseFocus', 'false');
    board('make', node('site', website));
    expect(focusOf('site')).toBeNull();
  });

  it('draws no toggle outside a canvas', () => {
    render(<PhaseFocusToggle />);
    expect(screen.queryByTestId('canvas-phase-focus-toggle')).toBeNull();
  });
});

describe('ghostPosition — where the phase\'s first object would go', () => {
  it('centres the ghost in the viewport on an empty board', () => {
    expect(ghostPosition([], { x: 500, y: 300 })).toEqual({ x: 500 - GHOST_CARD_WIDTH / 2, y: 240 });
  });

  it('stands just right of everything on the board, top-aligned with it', () => {
    const nodes = [
      { position: { x: 0, y: 100 }, measured: { width: 300 } },
      { position: { x: 400, y: 40 }, width: 200 },
      // Unmeasured and unsized: drawn at the card width.
      { position: { x: 100, y: 500 } },
    ];
    // Rightmost edge: max(0+300, 400+200, 100+260) = 600; top: 40.
    expect(ghostPosition(nodes, { x: 0, y: 0 })).toEqual({ x: 600 + GHOST_CARD_GAP, y: 40 });
  });

  it('ignores the viewport once anything is on the board', () => {
    const nodes = [{ position: { x: 10, y: 20 }, measured: { width: 100 } }];
    expect(ghostPosition(nodes, { x: 9999, y: 9999 })).toEqual(ghostPosition(nodes, { x: 0, y: 0 }));
  });
});

describe('usePhaseLensEdges — connections recede with their cards', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const nodes = [
    { id: 'a', data: { kind: 'note' } },
    { id: 'b', data: { kind: 'website' } },
    { id: 'c', data: { kind: 'note' } },
  ];
  const edges: Edge[] = [
    { id: 'a-c', source: 'a', target: 'c' },
    { id: 'a-b', source: 'a', target: 'b' },
    { id: 'c-b', source: 'c', target: 'b', className: 'authored' },
    { id: 'c-a', source: 'c', target: 'a', className: 'authored' },
  ];
  const mount = (phase: CanvasPhase | null) => renderHook(() => usePhaseLensEdges(nodes, edges), {
    ...(phase ? { wrapper: ({ children }: { children: ReactNode }) => <PhaseHarness phase={phase}>{children}</PhaseHarness> } : {}),
  });

  it('marks an edge only when BOTH ends are out of focus', () => {
    const result = mount('make').result.current;
    const byId = Object.fromEntries(result.map((edge) => [edge.id, edge]));
    // Both ends out: a new edge carrying the class.
    expect(byId['a-c']).not.toBe(edges[0]);
    expect(byId['a-c']!.className).toBe(styles.edgeOut);
    // One end in focus: untouched, the same object React Flow already had.
    expect(byId['a-b']).toBe(edges[1]);
    expect(byId['c-b']).toBe(edges[2]);
    // An authored class is kept, with the lens class beside it.
    expect(byId['c-a']).not.toBe(edges[3]);
    expect(byId['c-a']!.className).toBe(`authored ${styles.edgeOut}`);
  });

  it('hands back the input untouched when no card is out', () => {
    const allIn = [{ id: 'a', data: { kind: 'website' } }, { id: 'c', data: { kind: 'code' } }];
    const { result } = renderHook(() => usePhaseLensEdges(allIn, edges), {
      wrapper: ({ children }: { children: ReactNode }) => <PhaseHarness phase="make">{children}</PhaseHarness>,
    });
    expect(result.current).toBe(edges);
  });

  it('hands back the input untouched outside a canvas, and when the lens is off', () => {
    expect(mount(null).result.current).toBe(edges);
    window.localStorage.setItem('builderforce:create:phaseFocus', 'false');
    expect(mount('make').result.current).toBe(edges);
  });
});
