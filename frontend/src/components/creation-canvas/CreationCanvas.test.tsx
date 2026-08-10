import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { associateBrainWithArtifacts, canInvokeCreationObjectAction, canvasChangesCanAutoApply, CREATION_CANVAS_TOUR, CreationCanvas, duplicateAddUpdateTarget, persistCanonicalProjectPrd, projectEvermindNodePatch, scoreAgentTestResponse, shouldAcquireCanvasObjectLock, type ProposedCanvasChange } from './CreationCanvas';
import { writeSectionTourHistory } from '@/lib/onboarding/browserSectionTourHistory';
import { CreationNode } from './CreationNode';
import { BrainDock } from './BrainDock';
import { specsApi } from '@/lib/builderforceApi';
import type { CreationFlowNode } from './CreationNode';
import type { ProjectEvermindContributions, ProjectEvermindHead } from '@/lib/projectEvermindApi';
import { createLocalCreationSession } from '@/lib/creationSessions';
import { buildBrowserCreativeArtifact } from '@/lib/creationDeliverables';

vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useTranslations: (await import('@/test/realCatalogTranslations')).realCatalogTranslator(
    (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
  ),
}));

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));

/** Stable across renders so a test can assert what the board actually TOLD the user —
 *  a fresh set of spies per `useToast()` call could only ever assert "nothing". */
const toasts = vi.hoisted(() => ({ show: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toasts }));

/** Delegates to the real capture unless a test asks it to fail, so the success path
 *  keeps exercising the genuine builder. */
const capture = vi.hoisted(() => ({ failWith: null as string | null }));
vi.mock('@/lib/diagnosticsCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/diagnosticsCapture')>();
  return {
    captureDiagnosticsContext: async () => {
      if (capture.failWith) throw new Error(capture.failWith);
      return actual.captureDiagnosticsContext();
    },
  };
});

/**
 * What React Flow's store would hold about each node.
 *
 * An object reads its authored size off that store (`useAuthoredNodeSize`), so
 * the mock has to be a store and not an empty stub — otherwise every card
 * renders sizeless. The board fills this from the nodes it is handed; a test
 * that renders one object on its own registers it here itself.
 */
const nodeLookup = vi.hoisted(() => new Map<string, { width?: number; height?: number; style?: { width?: number; height?: number } }>());

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  const inert = () => null;
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    ReactFlow: ({ nodes, edges = [], nodeTypes, onNodeClick, children }: { nodes: Array<{ id: string; type?: string; data: unknown; style?: { width?: number; height?: number } }>; edges?: Array<{ source: string; target: string }>; nodeTypes: Record<string, React.ComponentType<Record<string, unknown>>>; onNodeClick?: (event: unknown, node: unknown) => void; children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'flow', 'data-edge-pairs': edges.map((edge) => `${edge.source}:${edge.target}`).join(',') }, children, nodes.map((node) => {
      nodeLookup.set(node.id, node);
      const Component = nodeTypes[node.type || 'creation'];
      return Component ? React.createElement('div', { key: node.id, onClick: (event: React.MouseEvent<HTMLDivElement>) => onNodeClick?.(event, node) }, React.createElement(Component, { id: node.id, data: node.data, selected: false, width: node.style?.width, height: node.style?.height })) : null;
    })),
    useNodesState: (initial: unknown[]) => { const [nodes, setNodes] = React.useState(initial); return [nodes, setNodes, inert] as const; },
    useStore: (selector: (state: { nodeLookup: typeof nodeLookup }) => unknown) => selector({ nodeLookup }),
    useEdgesState: (initial: unknown[]) => { const [edges, setEdges] = React.useState(initial); return [edges, setEdges, inert] as const; },
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    Background: inert,
    Controls: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    ControlButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props, children),
    MiniMap: inert, Handle: inert, NodeResizer: inert,
    BackgroundVariant: { Dots: 'dots' }, MarkerType: { ArrowClosed: 'arrowclosed' }, Position: { Left: 'left', Right: 'right' },
  };
});

vi.mock('@/components/workflow-builder/WorkflowBuilder', () => ({
  WorkflowBuilder: ({ onSaved, onRunStarted }: { onSaved?: (id: string, name: string) => void; onRunStarted?: (id: number) => void }) => <div>
    <button type="button" onClick={() => onSaved?.('workflow-updated', 'Updated campaign workflow')}>Save embedded workflow</button>
    <button type="button" onClick={() => onRunStarted?.(91)}>Run embedded workflow</button>
  </div>,
}));

// No suite-level timeout override: this file inherits the project ceiling. The
// 15s cap that used to live here was a mitigation for the render loop in the
// next-intl mock, and once that was fixed it became the only thing cutting off
// the heaviest mounts (3D, mini map) when this file runs alongside the other
// ~56 component files rather than on its own.
describe('CreationCanvas', () => {
  it('scores explicit agent-test criteria and preserves unscored review runs', () => {
    expect(scoreAgentTestResponse('I understand the duplicate charge. Please share your order number; I will investigate before discussing a refund.', 'duplicate charge, order number, investigate')).toMatchObject({ passed: true, missing: [] });
    expect(scoreAgentTestResponse('A refund is guaranteed.', 'ask for order number, explain investigation')).toMatchObject({ passed: false, matched: [] });
    expect(scoreAgentTestResponse('Happy to help.', '')).toEqual({ passed: null, matched: [], missing: [] });
  });
  it('keeps the mini map action visible while the mini map is opened, closed, and reopened', () => {
    render(<CreationCanvas sessionId="minimap-controls-test" persistence="local" />);

    expect(screen.getByRole('button', { name: 'Clean up canvas layout' })).toBeInTheDocument();
    const minimapAction = screen.getByRole('button', { name: 'Toggle mini map' });
    expect(minimapAction).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Close mini map' }));
    expect(minimapAction).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(minimapAction);
    expect(minimapAction).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Close mini map' })).toBeInTheDocument();
  });

  it('publishes the docked Brain footprint on whichever edge it claims', () => {
    // The command rail, the mini map and the 3D scene are pinned to the board's
    // edges and step aside from these two numbers. A dock that claims an edge
    // without publishing it is painted straight over the only canvas controls
    // there are, which is exactly how the rail disappeared under a left dock.
    const { container } = render(<CreationCanvas sessionId="brain-dock-footprint-test" persistence="local" />);
    const board = () => container.querySelector<HTMLElement>('[data-brain-side]')!;

    expect(board()).toHaveAttribute('data-brain-side', 'right');
    expect(board()).toHaveAttribute('data-brain-open', 'true');
    expect(board().style.getPropertyValue('--brain-dock-right')).toBe('330px');
    expect(board().style.getPropertyValue('--brain-dock-left')).toBe('0px');

    fireEvent.click(screen.getByRole('button', { name: 'Dock Brain to the left' }));
    expect(board()).toHaveAttribute('data-brain-side', 'left');
    expect(board().style.getPropertyValue('--brain-dock-left')).toBe('330px');
    expect(board().style.getPropertyValue('--brain-dock-right')).toBe('0px');

    // A closed Brain claims nothing, so the board takes its full width back.
    fireEvent.click(screen.getByRole('button', { name: 'Close Brain chat' }));
    expect(board()).toHaveAttribute('data-brain-side', 'none');
    expect(board()).toHaveAttribute('data-brain-open', 'false');
    expect(board().style.getPropertyValue('--brain-dock-left')).toBe('0px');
  });

  /**
   * The scene arrives ASYNCHRONOUSLY. `Canvas3DView` is a `next/dynamic` import
   * with `ssr: false`, so the click flips the mode synchronously and the module
   * lands a microtask later — a `getByTestId` on the next line asks before the
   * chunk exists. `findBy*` is the query that waits, and it is also the honest
   * one: this is what a real user's first entry into 3D does.
   */
  const enterThreeD = async () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Toggle 3D view' })[0]!);
    return screen.findByTestId('canvas-3d-view');
  };

  it('opens the 3D view from the canvas rail, then hands the board back', async () => {
    render(<CreationCanvas sessionId="three-d-controls-test" persistence="local" />);

    // The rail and the phone-sized action stack both offer the mode.
    const [toggle] = screen.getAllByRole('button', { name: 'Toggle 3D view' });
    expect(screen.queryByTestId('canvas-3d-view')).not.toBeInTheDocument();

    const scene = await enterThreeD();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(scene).toBeInTheDocument();
    // The mini map is a map of the flat board, so it — and its button — stand
    // down in 3D.
    expect(screen.queryByRole('button', { name: 'Close mini map' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Toggle mini map' })).not.toBeInTheDocument();
    // The rail owns every 3D command, so the scene carries no toolbar at all —
    // no exit, no depth control, no zoom. A second header stacked over the board
    // is what this replaced.
    expect(within(scene).queryByRole('button', { name: /3D/ })).not.toBeInTheDocument();
    expect(within(scene).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(scene).queryAllByRole('button', { name: 'Zoom in' })).toHaveLength(0);
    expect(toggle).toHaveAttribute('title', 'Exit 3D');

    // The scene's own commands ride the chrome the board already had — the rail
    // and the phone-sized stack both drive the scene, so each is offered twice.
    expect(screen.getAllByRole('button', { name: 'Zoom in' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Zoom out' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Reset view' })).toHaveLength(2);
    // Both read one controller: flipping the axis on the rail flips it everywhere.
    const depth = screen.getAllByRole('button', { name: 'Stack layers by object group' });
    expect(depth).toHaveLength(2);
    expect(depth.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    fireEvent.click(depth[0]!);
    expect(screen.getAllByRole('button', { name: 'Stack layers by object group' })
      .map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'true']);

    fireEvent.click(toggle!);
    expect(screen.queryByTestId('canvas-3d-view')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('title', 'View this canvas in 3D');
    // Leaving hands the rail back: the 3D commands go, the flat ones return.
    expect(screen.queryAllByRole('button', { name: 'Stack layers by object group' })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Toggle mini map' })).toBeInTheDocument();
  });

  it('selects the same object in 3D that the flat board would', async () => {
    render(<CreationCanvas sessionId="three-d-selection-test" persistence="local" />);

    const cards = (await enterThreeD()).querySelectorAll('[aria-pressed]');
    expect(cards.length).toBeGreaterThan(0);

    fireEvent.click(cards[0]!);
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true');
  });

  /** The x of `translate3d(x, y, z)`, which is where the space has put a card. */
  const cardX = (card: HTMLElement) => Number(/translate3d\((-?[\d.]+)px/.exec(card.style.transform)?.[1]);

  it('moves an object across the space and leaves it where it was dropped', async () => {
    render(<CreationCanvas sessionId="three-d-move-test" persistence="local" />);
    const card = (await enterThreeD()).querySelector<HTMLElement>('[data-movable="true"]')!;
    const before = cardX(card);

    fireEvent.pointerDown(card, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.pointerMove(window, { clientX: 190, clientY: 40 });
    fireEvent.pointerUp(window);

    // Dragging right carries the object right, and it stays there once dropped.
    expect(cardX(card)).toBeGreaterThan(before);
    const dropped = cardX(card);
    fireEvent.pointerMove(window, { clientX: 600, clientY: 600 });
    expect(cardX(card)).toBe(dropped);
  });

  it('lifts an object off its layer with shift, and settles it back on request', async () => {
    render(<CreationCanvas sessionId="three-d-depth-test" persistence="local" />);
    const card = (await enterThreeD()).querySelector<HTMLElement>('[data-movable="true"]')!;
    // Nothing is floating yet, so the rail does not offer to tidy anything up.
    expect(screen.queryAllByRole('button', { name: 'Settle objects back onto their layers' })).toHaveLength(0);

    fireEvent.pointerDown(card, { clientX: 40, clientY: 200, button: 0, shiftKey: true });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 80 });
    fireEvent.pointerUp(window);

    const settle = screen.getAllByRole('button', { name: 'Settle objects back onto their layers' });
    expect(settle.length).toBeGreaterThan(0);
    fireEvent.click(settle[0]!);
    expect(screen.queryAllByRole('button', { name: 'Settle objects back onto their layers' })).toHaveLength(0);
  });

  it('puts the layer guides away without moving a single object', async () => {
    render(<CreationCanvas sessionId="three-d-guides-test" persistence="local" />);
    const scene = await enterThreeD();
    const card = scene.querySelector<HTMLElement>('[data-movable="true"]')!;
    const placed = cardX(card);
    expect(scene.textContent).toContain('Layer 1');

    // The guides are a reading aid over the space, so putting them away is a
    // question about the view and never about where anything sits.
    const guides = screen.getAllByRole('button', { name: 'Layer guides' });
    expect(guides.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
    fireEvent.click(guides[0]!);

    expect(screen.getByTestId('canvas-3d-view').textContent).not.toContain('Layer 1');
    expect(screen.getAllByRole('button', { name: 'Layer guides' })
      .map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    expect(cardX(card)).toBe(placed);
  });

  it('auto-applies basic canvas output but keeps consequential changes in review', () => {
    const visual = {
      id: 'add-visual', type: 'object.add', label: 'Add astronomy visual',
      node: { id: 'visual', type: 'creation', position: { x: 100, y: 100 }, data: { kind: 'mockup', title: 'Astronomy visual' } },
    } satisfies ProposedCanvasChange;
    const response = {
      id: 'update-response', type: 'object.update', label: 'Update Brain response',
      objectId: 'brain', patch: { aiResponse: 'A foundational explanation.' },
    } satisfies ProposedCanvasChange;

    expect(canvasChangesCanAutoApply([visual, response])).toBe(true);
    expect(canvasChangesCanAutoApply([{ id: 'delete', type: 'object.delete', label: 'Delete', objectId: 'visual' }])).toBe(false);
    expect(canvasChangesCanAutoApply([{
      ...visual, id: 'canonical-prd', node: { ...visual.node, data: { ...visual.node.data, kind: 'prd', canonicalPrdPending: true } },
    }])).toBe(false);
  });

  it('distinguishes real Canvas actions from advertised capability intent', () => {
    expect(canInvokeCreationObjectAction('workflow', 'run')).toBe(true);
    expect(canInvokeCreationObjectAction('mockup', 'deliver')).toBe(true);
    expect(canInvokeCreationObjectAction('website', 'publish')).toBe(true);
    expect(canInvokeCreationObjectAction('video', 'generate')).toBe(true);
  });

  beforeEach(() => {
    localStorage.clear();
    // The guided-tour offer fires on the FIRST visit to a section, and a guest
    // board's audience is the constant `guest` — so clearing storage above made
    // every render in this file open the welcome dialog over the canvas. Two
    // tests then measured the tour instead of the thing they name (a `dialog`
    // that should be gone after dismissing the account gate; the Brain mark
    // behind an overlay). Seeding a dismissed history is the returning-visitor
    // state 76 of these 78 tests already assume; the tour has its own tests.
    writeSectionTourHistory(CREATION_CANVAS_TOUR.sectionId, 'guest', { ...CREATION_CANVAS_TOUR, visits: 1, outcome: 'dismissed' });
    capture.failWith = null;
    for (const spy of Object.values(toasts)) spy.mockClear();
  });

  it('automatically executes the prompt carried from the homepage', async () => {
    const sessionId = createLocalCreationSession('Create a roadmap for the launch');

    render(<CreationCanvas sessionId={sessionId} persistence="local" />);

    await waitFor(() => expect(screen.getAllByText('Sales presentation roadmap').length).toBeGreaterThan(0), { timeout: 2_000 });
  });

  it('groups canvas history controls without changing their accessible actions', () => {
    render(<CreationCanvas sessionId="history-controls-test" persistence="local" />);
    const group = screen.getByRole('group', { name: 'Canvas history' });
    expect(group).toContainElement(screen.getByRole('button', { name: 'Undo canvas change' }));
    expect(group).toContainElement(screen.getByRole('button', { name: 'Redo canvas change' }));
  });

  it('keeps the mobile canvas view action rail available when the palette is closed', () => {
    render(<CreationCanvas sessionId="mobile-canvas-actions-test" persistence="local" />);
    const controls = screen.getByRole('group', { name: 'Canvas view controls' });
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Zoom in' }));
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Zoom out' }));
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Fit canvas to view' }));
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Arrange canvas objects' }));
  });

  it('defaults the mobile palette closed and remembers the user preference', async () => {
    const desktopWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const first = render(<CreationCanvas sessionId="mobile-palette-test" persistence="local" />);

    await waitFor(() => expect(screen.queryByText('Add to canvas')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Toggle object palette' }));
    await waitFor(() => expect(screen.getByText('Add to canvas')).toBeInTheDocument());
    expect(localStorage.getItem('builderforce:create:palette-open')).toBe('1');

    first.unmount();
    render(<CreationCanvas sessionId="mobile-palette-restored-test" persistence="local" />);
    await waitFor(() => expect(screen.getByText('Add to canvas')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Close palette' }));
    await waitFor(() => expect(localStorage.getItem('builderforce:create:palette-open')).toBe('0'));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: desktopWidth });
  });

  it('opens the outcome scorecard from the session bar and explains local baselines', () => {
    render(<CreationCanvas sessionId="outcome-metrics-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'View outcome metrics' }));
    expect(screen.getByRole('complementary', { name: 'Session outcome metrics' })).toBeInTheDocument();
    expect(screen.getByText('Idea → delivery')).toBeInTheDocument();
    expect(screen.getByText('Save to establish a baseline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close outcome metrics' }));
    expect(screen.queryByRole('complementary', { name: 'Session outcome metrics' })).not.toBeInTheDocument();
  });

  it('does not lock a newly created server object until autosave persists it', () => {
    const objectId = 'a5d80af7-bb65-45cc-bd2b-d190616fc904';
    expect(shouldAcquireCanvasObjectLock('server', objectId, true, new Set())).toBe(false);
    expect(shouldAcquireCanvasObjectLock('server', objectId, true, new Set([objectId]))).toBe(true);
  });

  it('persists an accepted PRD to its canonical project before materializing its canvas reference', async () => {
    const createSpec = vi.fn(async (body: Parameters<typeof specsApi.create>[0]) => ({
      id: '6f4b36f8-f8a0-49e8-aeed-faa42cacad11', projectId: body.projectId ?? null,
      goal: body.goal, prd: body.prd ?? null, status: body.status ?? 'draft', kind: body.kind,
    })) as typeof specsApi.create;
    const node = {
      id: 'prd-node', type: 'creation', position: { x: 500, y: 200 },
      data: { kind: 'prd', title: 'BuilderForce consolidated PRD', status: 'ready', markdown: '# Complete requirements', sourceProjectId: 42, canonicalPrdPending: true },
    } satisfies CreationFlowNode;

    const saved = await persistCanonicalProjectPrd(node, createSpec);

    expect(createSpec).toHaveBeenCalledWith({ projectId: 42, goal: 'BuilderForce consolidated PRD', prd: '# Complete requirements', status: 'ready', kind: 'feature' });
    expect(saved.data.resourceId).toBe('spec:6f4b36f8-f8a0-49e8-aeed-faa42cacad11');
    expect(saved.data.canonicalPrdPending).toBeUndefined();
  });

  it('associates Brain with artifacts once without duplicating relationships', () => {
    const once = associateBrainWithArtifacts([], 'brain', ['artifact']);
    const twice = associateBrainWithArtifacts(once, 'brain', ['artifact']);
    expect(once).toHaveLength(1);
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ source: 'brain', target: 'artifact', label: 'Brain context', data: { connectionKind: 'reference' } });
  });

  it('redirects selected-object corrections to update while allowing an explicit additional chart', () => {
    const chart = { id: 'chart-1', type: 'creation', position: { x: 0, y: 0 }, data: { kind: 'chart', title: 'Tasks by status' } } satisfies CreationFlowNode;
    expect(duplicateAddUpdateTarget('What do you mean by Reach? Change those labels.', 'chart', [chart], [chart.id])).toBe(chart);
    expect(duplicateAddUpdateTarget('Add labels to the chart', 'chart', [chart], [chart.id])).toBe(chart);
    expect(duplicateAddUpdateTarget('Create another chart for priority', 'chart', [chart], [chart.id])).toBeUndefined();
  });

  it('fills the persisted project boundary with the visible project card', () => {
    // Rendered on its own, so there is no board to publish its authored box.
    nodeLookup.set('project-node', { width: 320, height: 220 });
    render(<CreationNode
      id="project-node"
      type="creation"
      data={{ kind: 'project', title: 'BuilderForce.AI' }}
      selected
      width={320}
      height={220}
      dragging={false}
      zIndex={0}
      selectable
      deletable
      draggable
      isConnectable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
    />);

    expect(screen.getByRole('article')).toHaveStyle({ width: '320px', height: '220px' });
  });

  it('makes the agent lifecycle discoverable from the canvas cards', () => {
    const onOpenDetails = vi.fn();
    const props = {
      type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
      selectable: true, deletable: true, draggable: true, isConnectable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0, onOpenDetails,
    };
    const { rerender } = render(<CreationNode {...props} id="agent-card" data={{ kind: 'agent', title: 'Customer Support Agent' }} />);
    fireEvent.click(screen.getByRole('button', { name: '1 · Add knowledge' }));
    fireEvent.click(screen.getByRole('button', { name: '2 · Test agent' }));
    expect(onOpenDetails).toHaveBeenNthCalledWith(1, 'agent-card', 'knowledge');
    expect(onOpenDetails).toHaveBeenNthCalledWith(2, 'agent-card', 'test');

    rerender(<CreationNode {...props} id="evaluation-card" data={{ kind: 'evaluation', title: 'Agent Evaluation' }} />);
    fireEvent.click(screen.getByRole('button', { name: '3 · Review evaluation' }));
    expect(onOpenDetails).toHaveBeenLastCalledWith('evaluation-card', 'evaluation');

    rerender(<CreationNode {...props} id="release-card" data={{ kind: 'release', title: 'Agent Release' }} />);
    fireEvent.click(screen.getByRole('button', { name: '4 · Open delivery checklist' }));
    expect(onOpenDetails).toHaveBeenLastCalledWith('release-card', 'delivery');
  });

  it('updates the project widget rendering when its project view changes', () => {
    const props = {
      id: 'project-node', type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
      selectable: true, deletable: true, draggable: true, isConnectable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
    };
    const { rerender } = render(<CreationNode {...props} data={{ kind: 'project', title: 'BuilderForce.AI', status: 'active' }} />);
    expect(screen.getByText('Project context')).toBeInTheDocument();

    rerender(<CreationNode {...props} data={{ kind: 'project', title: 'BuilderForce.AI', projectLens: 'delivery', open: 12, blocked: 2 }} />);
    expect(screen.getByText('Open work')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();

    rerender(<CreationNode {...props} data={{ kind: 'project', title: 'BuilderForce.AI', projectLens: 'metrics', velocity: 48 }} />);
    expect(screen.getByText('Maturity')).toBeInTheDocument();
    expect(screen.getByText('48 pts')).toBeInTheDocument();

    rerender(<CreationNode {...props} data={{ kind: 'project', title: 'BuilderForce.AI', projectLens: 'customer-feedback', feedback: ['Faster onboarding'] }} />);
    expect(screen.getByText('Customer feedback')).toBeInTheDocument();
    expect(screen.getByText('Faster onboarding')).toBeInTheDocument();
  });

  it('renders authored chart labels and values instead of an unlabeled placeholder mix', () => {
    render(<CreationNode
      id="status-chart" type="creation" selected={false} dragging={false} zIndex={0}
      selectable deletable draggable isConnectable positionAbsoluteX={0} positionAbsoluteY={0}
      data={{
        kind: 'chart', title: 'Task status distribution', chartType: 'doughnut', chartTitle: 'Current task status', xAxisLabel: 'Status', yAxisLabel: 'Task count',
        chartLabels: ['In Progress', 'Ready', 'Done', 'To Do', 'Backlog', 'Blocked', 'In Review', 'Review'],
        chartValues: [95, 42, 35, 18, 12, 12, 3, 2],
      }}
    />);

    expect(screen.getByRole('img', { name: /In Progress: 95.*Review: 2/ })).toBeInTheDocument();
    expect(screen.getByText('Distribution')).toBeInTheDocument();
    expect(screen.getByText('Current task status')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Task count')).toBeInTheDocument();
    expect(screen.getAllByText('In Review')).toHaveLength(2);
    expect(screen.queryByText('Reach')).not.toBeInTheDocument();
  });

  it('visualizes single-project quality diagnostics and recommendations', () => {
    render(<CreationNode
      id="quality-node" type="creation" selected={false} dragging={false} zIndex={0}
      selectable deletable draggable isConnectable positionAbsoluteX={0} positionAbsoluteY={0}
      data={{
        kind: 'diagnostics', title: 'BuilderForce.AI quality', qualityScore: 72, qualityLabel: 'Needs attention',
        qualityHeadline: 'Two checks found release risk', diagnosticCount: 2, gapCount: 3,
        diagnostics: [
          { toolId: 'code-quality', name: 'Code quality', icon: '◆', score: 84, scoreLabel: 'Healthy', headline: 'Core checks pass', gapCount: 1, recommendations: [{ title: 'Raise branch coverage', detail: 'Cover the error paths.' }] },
          { toolId: 'delivery', name: 'Delivery readiness', icon: '△', score: 60, scoreLabel: 'At risk', headline: 'CI is unstable', gapCount: 2, recommendations: [{ title: 'Fix failing CI', detail: 'Resolve the release-blocking tests.' }] },
        ],
        recommendations: [{ title: 'Fix failing CI', detail: 'Resolve the release-blocking tests.', diagnostic: 'Delivery readiness' }],
      }}
    />);

    expect(screen.getByRole('region', { name: 'Project quality' })).toHaveTextContent('72/100');
    expect(screen.getByRole('region', { name: 'Diagnostics findings' })).toHaveTextContent('Delivery readiness');
    expect(screen.getByRole('region', { name: 'Diagnostic next steps' })).toHaveTextContent('Fix failing CI');
  });

  it('compares quality across projects and prioritizes recommendations', () => {
    render(<CreationNode
      id="comparison-node" type="creation" selected={false} dragging={false} zIndex={0}
      selectable deletable draggable isConnectable positionAbsoluteX={0} positionAbsoluteY={0}
      data={{ kind: 'projectComparison', title: 'Portfolio quality', fetchedAt: '2026-08-02T12:00:00.000Z', projects: [
        { name: 'Alpha', status: 'active', qualityScore: 88, qualityLabel: 'Healthy', diagnosticCount: 2, gapCount: 1, progress: 70, open: 4, blocked: 0, diagnostics: [{ toolId: 'quality', name: 'Code quality', score: 88, gapCount: 1 }], recommendations: [{ title: 'Add edge-case tests', detail: 'Close the remaining gap.', diagnostic: 'Code quality', score: 88 }] },
        { name: 'Beta', status: 'active', qualityScore: 52, qualityLabel: 'At risk', diagnosticCount: 2, gapCount: 4, progress: 30, open: 9, blocked: 3, diagnostics: [{ toolId: 'delivery', name: 'Delivery readiness', score: 52, gapCount: 4 }], recommendations: [{ title: 'Stabilize CI first', detail: 'The build blocks delivery.', diagnostic: 'Delivery readiness', score: 52 }] },
      ] }}
    />);

    expect(screen.getByRole('region', { name: 'Portfolio quality summary' })).toHaveTextContent('70/100');
    expect(screen.getByRole('region', { name: 'Prioritized recommendations' })).toHaveTextContent('Stabilize CI first');
    expect(screen.getByText('Lowest-scoring evidence first')).toBeInTheDocument();
  });

  it('visualizes every diagnostic with its result and next steps', () => {
    render(<CreationNode
      id="diagnostics-node"
      type="creation"
      data={{
        kind: 'diagnostics', title: 'Build diagnostics', summary: 'Build completed with issues',
        diagnostics: [
          { id: 'ts-1', severity: 'error', message: 'Type mismatch', detail: 'Expected string but received number', path: 'src/app.ts', line: 42, result: 'Failed', recommendation: 'Correct the value type.' },
          { id: 'lint-1', severity: 'warning', message: 'Unused import', result: 'Warning' },
          { id: 'test-1', severity: 'passed', message: 'Unit tests', result: 'Passed' },
        ],
        results: ['18 checks ran', '1 check failed'],
        nextSteps: ['Fix the failing type check', 'Run the suite again'],
      }}
      selected={false}
      dragging={false}
      zIndex={0}
      selectable
      deletable
      draggable
      isConnectable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
    />);

    expect(screen.getByRole('region', { name: 'Diagnostics findings' })).toHaveTextContent('Type mismatch');
    expect(screen.getByRole('region', { name: 'Diagnostics findings' })).toHaveTextContent('Unused import');
    expect(screen.getByRole('region', { name: 'Diagnostics findings' })).toHaveTextContent('Unit tests');
    expect(screen.getByRole('region', { name: 'Diagnostic results' })).toHaveTextContent('Build completed with issues');
    expect(screen.getByRole('region', { name: 'Diagnostic results' })).toHaveTextContent('18 checks ran');
    expect(screen.getByRole('region', { name: 'Diagnostic next steps' })).toHaveTextContent('Fix the failing type check');
    expect(screen.getByRole('region', { name: 'Diagnostic next steps' })).toHaveTextContent('Correct the value type.');
  });

  it('applies the inspector project view selection to the canvas widget', () => {
    render(<CreationCanvas sessionId="project-view-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));

    const projectView = screen.getByLabelText('Project view');
    fireEvent.change(projectView, { target: { value: 'metrics' } });
    expect(screen.getByText('Maturity')).toBeInTheDocument();

    fireEvent.change(projectView, { target: { value: 'delivery' } });
    expect(screen.getByText('Open work')).toBeInTheDocument();
    expect(screen.queryByText('Maturity')).not.toBeInTheDocument();
  });

  it('expands, restores, and keyboard-resizes the details panel', () => {
    render(<CreationCanvas sessionId="inspector-resize-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));

    const inspector = screen.getByRole('complementary', { name: 'Details panel' });
    const resizeHandle = screen.getByRole('separator', { name: 'Resize details panel' });
    expect(inspector).toHaveStyle({ '--inspector-width': '270px' });

    fireEvent.click(screen.getByRole('button', { name: 'Expand details panel' }));
    expect(inspector).toHaveStyle({ '--inspector-width': '520px' });
    expect(localStorage.getItem('builderforce:create:inspector-width')).toBe('520');

    fireEvent.click(screen.getByRole('button', { name: 'Restore details panel width' }));
    expect(inspector).toHaveStyle({ '--inspector-width': '270px' });

    fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });
    expect(inspector).toHaveStyle({ '--inspector-width': '290px' });
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '290');
  });

  it('renders agent model, instructions, tools, and autonomy changes live', () => {
    render(<CreationCanvas sessionId="agent-settings-test" persistence="local" />);
    fireEvent.click(screen.getAllByText('Campaign Strategist')[0]!);

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Evermind' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Investigate customer friction.' } });
    fireEvent.change(screen.getByLabelText('Autonomy'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add tool' }));

    expect(screen.getAllByText('Evermind').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Investigate customer friction.').length).toBeGreaterThan(1);
    expect(screen.getByText('High autonomy')).toBeInTheDocument();
    expect(screen.getByText('Research')).toBeInTheDocument();
  });

  it('visualizes an agent collaborator avatar, thinking state, and latest response', () => {
    const base = {
      id: 'agent-collaborator', type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
      selectable: true, deletable: true, draggable: true, isConnectable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
    };
    const view = render(<CreationNode {...base} data={{ kind: 'agent', title: 'Research Partner', model: 'auto', collaborationState: 'thinking' }} />);
    expect(screen.getByText('RP')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Thinking');
    expect(screen.getByText('Auto model')).toBeInTheDocument();

    view.rerender(<CreationNode {...base} data={{ kind: 'agent', title: 'Research Partner', resourceId: 'agent:research', model: 'Evermind', collaborationReply: 'The interviews point to onboarding friction.' }} />);
    expect(screen.getByText('Configured agent')).toBeInTheDocument();
    expect(screen.getByText('Latest response')).toBeInTheDocument();
    expect(screen.getByText('The interviews point to onboarding friction.')).toBeInTheDocument();
  });

  it('visualizes a person joining, composing, and authoring a shared prompt', () => {
    render(<BrainDock
      mode="docked" side="right" size="slim" width={330} showExecutionDetail={false}
      onModeChange={vi.fn()} onSideChange={vi.fn()} onSizeChange={vi.fn()} onWidthChange={vi.fn()}
      onExecutionDetailChange={vi.fn()} onClose={vi.fn()}
      messages={[{ id: 1, seq: 1, role: 'user', content: 'Let us compare the research themes.', metadata: JSON.stringify({ authoredBy: { kind: 'human', ref: 'user-ada', name: 'Ada Rivera' } }), createdAt: new Date().toISOString() }]}
      trace={[]} running={false} node={null} nodes={[]} edges={[]}
      joinedCollaborator={{ userId: 'user-ada', displayName: 'Ada Rivera' }}
      collaborators={[{ userId: 'user-ada', displayName: 'Ada Rivera', typing: true }]}
    />);

    expect(screen.getByText('Ada Rivera joined the conversation')).toBeInTheDocument();
    expect(screen.getByText('Ada Rivera is writing')).toBeInTheDocument();
    expect(screen.getByText('Let us compare the research themes.')).toBeInTheDocument();
    expect(screen.getAllByText('Ada Rivera').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AR').length).toBeGreaterThan(1);
  });

  it('renders workflow target and approval changes live', () => {
    render(<CreationCanvas sessionId="workflow-settings-test" persistence="local" />);
    fireEvent.click(screen.getByText('Fall campaign workflow'));

    fireEvent.change(screen.getByLabelText('Execution target'), { target: { value: 'campaign-strategist' } });
    fireEvent.change(screen.getByLabelText('Approval mode'), { target: { value: 'autonomous' } });

    expect(screen.getAllByText('Campaign Strategist').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Fully autonomous').length).toBeGreaterThan(1);
  });

  it('renders dashboard range and refresh changes live', () => {
    render(<CreationCanvas sessionId="dashboard-settings-test" persistence="local" />);
    fireEvent.click(screen.getByText('Campaign forecast'));

    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'qtd' } });
    expect(screen.getAllByText('Quarter to date').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live data' }));
    expect(screen.getByText('Refreshed')).toBeInTheDocument();
  });

  it('renders mockup delivery selections and uses explicit unassignment', () => {
    render(<CreationCanvas sessionId="mockup-settings-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mockup' }));

    fireEvent.change(screen.getByLabelText('Delivery project'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Assign agent'), { target: { value: 'web-analyst' } });

    expect(screen.getByText('Project: No project')).toBeInTheDocument();
    expect(screen.getByText('Agent: Web Analyst')).toBeInTheDocument();
  });

  it('shows task ownership, priority, PRD context, and completion criteria on the widget', () => {
    render(<CreationNode
      id="task-node" type="creation" selected={false} dragging={false} zIndex={0} selectable deletable draggable isConnectable
      positionAbsoluteX={0} positionAbsoluteY={0}
      data={{ kind: 'task', title: 'Ship task details', status: 'in_progress', assignee: 'Delivery Agent', priority: 'high', content: 'Close the information gaps.', prdTitle: 'Task widget parity', prdSummary: 'Show the context an agent needs.', acceptanceCriteria: 'Owner, state, and requirements are visible.' }}
    />);

    expect(screen.getByText('Delivery Agent')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('Task widget parity')).toBeInTheDocument();
    expect(screen.getByText('Owner, state, and requirements are visible.')).toBeInTheDocument();
  });

  it('renders staff and task inspector edits live on their widgets', () => {
    render(<CreationCanvas sessionId="people-work-settings-test" persistence="local" />);
    fireEvent.click(screen.getByText('Sarah'));
    fireEvent.change(screen.getByDisplayValue('Marketing'), { target: { value: 'Product lead' } });
    fireEvent.change(screen.getByLabelText('Current focus'), { target: { value: 'Validate the launch scope.' } });
    expect(screen.getByText('Product lead')).toBeInTheDocument();
    expect(screen.getAllByText('Validate the launch scope.').length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'Task' }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'blocked' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'urgent' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Resolve the release dependency.' } });
    fireEvent.change(screen.getByLabelText('Acceptance criteria'), { target: { value: 'Dependency is closed.' } });
    expect(screen.getByText('urgent')).toBeInTheDocument();
    expect(screen.getAllByText('Resolve the release dependency.').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Dependency is closed.').length).toBeGreaterThan(1);
  });

  it('gives task widgets actionable status, agent, and PRD details', () => {
    render(<CreationCanvas sessionId="task-details-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Task' }));

    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Assigned agent')).toHaveDisplayValue(/Campaign Strategist/);
    expect(screen.getByText('How to move this forward')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Task PRD' })).toHaveTextContent('No PRD linked');
  });

  it('renders live workflow, website, dashboard, collaborators, and agent controls', () => {
    render(<CreationCanvas sessionId="campaign-test" persistence="local" />);

    expect(screen.getByText('Fall campaign workflow')).toBeInTheDocument();
    expect(screen.getAllByText('Campaign landing page').length).toBeGreaterThan(0);
    expect(screen.getByText('Campaign forecast')).toBeInTheDocument();
    expect(screen.getByLabelText('Active collaborators')).toBeInTheDocument();
    const canvasPrompt = screen.getByLabelText('Ask Brain about this canvas');
    expect(canvasPrompt).toHaveValue('');
    // ChatInput must not override the Canvas dock's bounded CSS width inline.
    // An inline 100% made the composer span the entire viewport.
    expect(canvasPrompt.closest('form')?.style.width).toBe('');
    fireEvent.click(screen.getAllByText('Campaign Strategist')[0]!);
    expect(screen.getByDisplayValue('Campaign Strategist')).toBeInTheDocument();
  });

  it('uses the compact composer controls for models, artifacts, and memory', async () => {
    const { container } = render(<CreationCanvas sessionId="compact-composer-test" persistence="local" />);

    // Model choice lives in the shared `/` control, which also states the armed
    // mode and the model in use. The trigger names all three, so the assertion
    // spans them rather than assuming they stay adjacent — the mode segment was
    // added between them when work/chat mode shipped.
    const options = screen.getByRole('button', { name: /^Options ·.*Model in use/ });
    expect(options).toHaveTextContent('/');
    // Memory is INSIDE that menu, not a button of its own: this row had grown to
    // eight unlabelled circles, and memory was one of the two settings that
    // actually decide what a turn does.
    fireEvent.click(options);
    expect(screen.getByText('Memory')).toBeInTheDocument();
    fireEvent.click(options);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('menuitem', { name: /Upload from computer/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Add context/ })).toBeInTheDocument();

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [new File(['image'], 'concept.png', { type: 'image/png' })] } });
    await waitFor(() => expect(screen.getAllByText('concept.png').length).toBeGreaterThan(0));
  });

  it('keeps exactly ONE Brain transcript — the dock — with its connected work behind a tab', () => {
    render(<CreationCanvas sessionId="brain-object-details-test" persistence="local" />);

    // One transcript, not three: the Brain Object and the details panel no longer
    // render competing copies of the same conversation.
    expect(screen.getAllByRole('log', { name: 'Brain chat history' })).toHaveLength(1);
    expect(screen.getByRole('log', { name: 'Brain chat history' })).toHaveAttribute('tabindex', '0');
    const microphone = screen.getByRole('button', { name: 'Dictate' });
    expect(microphone.querySelector('svg')).toBeInTheDocument();
    const options = screen.getByRole('button', { name: /^Options/ });
    fireEvent.click(options);
    const autoApply = screen.getByRole('menuitemcheckbox', { name: /Auto mode/ });
    expect(autoApply).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(autoApply);
    expect(autoApply).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('brain.autoApprove')).toBe('0');

    fireEvent.click(screen.getByRole('tab', { name: 'Context' }));
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Associated tickets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Connected objects' })).toBeInTheDocument();
  });

  it('docks Brain to one side only and remembers the layout the user picked', () => {
    render(<CreationCanvas sessionId="brain-dock-preference-test" persistence="local" />);

    const dock = screen.getByRole('complementary', { name: 'Brain chat' });
    expect(dock).toHaveAttribute('data-side', 'right');
    expect(dock).toHaveAttribute('data-size', 'slim');
    expect(dock).toHaveAttribute('data-mode', 'docked');

    fireEvent.click(screen.getByRole('button', { name: 'Dock Brain to the left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Brain chat' }));

    expect(screen.getByRole('complementary', { name: 'Brain chat' })).toHaveAttribute('data-side', 'left');
    expect(screen.getByRole('complementary', { name: 'Brain chat' })).toHaveAttribute('data-size', 'expanded');
    expect(JSON.parse(localStorage.getItem('builderforce:create:brain-dock')!)).toMatchObject({ side: 'left', size: 'expanded' });

    // Closing Brain must leave a way back to it — and must NOT take the prompt with
    // it, because the prompt belongs to the page, not to the Brain surface.
    fireEvent.click(screen.getByRole('button', { name: 'Close Brain chat' }));
    expect(screen.queryByRole('complementary', { name: 'Brain chat' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ask Brain about this canvas')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show Brain chat' }));
    expect(screen.getByRole('complementary', { name: 'Brain chat' })).toBeInTheDocument();
    // Four placement changes re-render the whole board, which runs ~20s on a loaded
    // box — past the default. A timeout here would read as "the dock broke" when it
    // only means "slow runner".
  }, 60_000);

  it('keeps the prompt in the centre of the page instead of inside the Brain surface', () => {
    render(<CreationCanvas sessionId="brain-prompt-placement-test" persistence="local" />);

    // People expect to type at the bottom-centre of the page, the way every other
    // chat product works. Nesting the prompt in the side panel is what broke that.
    const prompt = screen.getByLabelText('Ask Brain about this canvas');
    expect(screen.getByRole('complementary', { name: 'Brain chat' })).not.toContainElement(prompt);
    // The composer utility row owns both status and starting points, keeping the
    // former at the left edge and the latter at the right without moving the input.
    const starter = screen.getByRole('button', { name: 'Choose a starting point' });
    expect(prompt.closest('[data-tour="creation-brain-dock"]')).toContainElement(starter);
    expect(starter.closest('[data-tour="creation-prompt-starter"]')).not.toBeNull();
    expect(starter.closest('[data-align="end"]')).not.toBeNull();
    expect(starter.closest('[data-placement="top"]')).not.toBeNull();
  });

  it('moves Brain into its Object rather than putting a second chat on the board', () => {
    render(<CreationCanvas sessionId="brain-inline-test" persistence="local" />);

    // Docked: the edge panel holds the conversation and the Object is Brain's mark.
    const dock = screen.getByRole('complementary', { name: 'Brain chat' });
    const board = dock.parentElement;
    expect(screen.getByRole('button', { name: 'Open Brain chat' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show the chat in the Brain object' }));

    // THE invariant: one conversation, one transcript. The small placement used to be
    // a card floating over a board that already carried the Brain Object, so the same
    // chat was on screen twice and nobody could tell which one they were talking to.
    expect(screen.queryByRole('complementary', { name: 'Brain chat' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('log', { name: 'Brain chat history' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Brain chat' })).toBeInTheDocument();
    // The Object IS the chat now, so the anchor's way back to a panel is gone too.
    expect(screen.queryByRole('button', { name: 'Open Brain chat' })).not.toBeInTheDocument();
    // An inline Brain is an Object on the board, so the board gives up no width.
    expect(board?.style.getPropertyValue('--brain-dock-right')).toBe('0px');
    expect(JSON.parse(localStorage.getItem('builderforce:create:brain-dock')!)).toMatchObject({ mode: 'inline' });

    fireEvent.click(screen.getByRole('button', { name: 'Dock Brain to the edge' }));
    expect(screen.getByRole('complementary', { name: 'Brain chat' })).toHaveAttribute('data-mode', 'docked');
    expect(screen.getAllByRole('log', { name: 'Brain chat history' })).toHaveLength(1);
    expect(board?.style.getPropertyValue('--brain-dock-right')).toBe('330px');
  });

  it('collapses the Brain Object to its mark while the conversation is docked', () => {
    render(<CreationCanvas sessionId="brain-marker-test" persistence="local" />);

    // ONE frame of reference: with the conversation in a full-height edge panel, the
    // Object stops being a second reading of it. It keeps Brain's place in the graph
    // and its state — nothing else. The regression is a board card repeating the same
    // exchange the dock is already showing a few hundred pixels away.
    // The mark is the house icon language, not a literal glyph: `Icon` maps
    // every legacy emoji onto an SVG so the same mark renders identically on
    // every OS. This asserted `textContent === '✦'`, which that migration made
    // permanently `''` — so the test was measuring the absence of a character
    // rather than the presence of the mark.
    const marker = screen.getByRole('button', { name: 'Open Brain chat' });
    expect(marker.querySelector('svg.ui-icon')).not.toBeNull();
    expect(marker.textContent).toBe('');
    expect(marker).toHaveAttribute('data-state', 'idle');

    // Closed, the board is the only surface left, so the Object goes back to showing
    // the conversation rather than a mark pointing at a panel that is not there —
    // and the way back becomes a labelled control on the card, not the mark.
    fireEvent.click(screen.getByRole('button', { name: 'Close Brain chat' }));
    const anchor = screen.getByRole('button', { name: 'Open Brain chat' });
    expect(anchor.textContent).toBe('Open Brain chat');
    expect(anchor.querySelector('svg.ui-icon')).toBeNull();
  });

  it('lets the Brain Object reopen an inline Brain without a second launcher', () => {
    render(<CreationCanvas sessionId="brain-inline-reopen-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show the chat in the Brain object' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Brain chat' }));

    // The Object is back to its anchor and offers the only way back — the floating
    // launcher pill would be a second control for the same job on the same board.
    expect(screen.queryByRole('region', { name: 'Brain chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show Brain chat' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Brain chat' }));
    expect(screen.getByRole('region', { name: 'Brain chat' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Brain chat' })).not.toBeInTheDocument();
  });

  it('resizes Brain from the keyboard and remembers the width', () => {
    render(<CreationCanvas sessionId="brain-resize-test" persistence="local" />);

    const resizer = screen.getByRole('separator', { name: 'Resize Brain chat' });
    expect(resizer).toHaveAttribute('aria-valuenow', '330');

    // Brain is docked right, so widening it means dragging its edge leftwards.
    fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
    expect(screen.getByRole('separator', { name: 'Resize Brain chat' })).toHaveAttribute('aria-valuenow', '354');
    expect(JSON.parse(localStorage.getItem('builderforce:create:brain-dock')!)).toMatchObject({ width: 354 });

    // Presets clear a stale drag width, so "expand" always actually expands.
    fireEvent.click(screen.getByRole('button', { name: 'Expand Brain chat' }));
    expect(screen.getByRole('separator', { name: 'Resize Brain chat' })).toHaveAttribute('aria-valuenow', '520');
  });

  it('hides Brain execution steps until the user turns that feedback on', () => {
    render(<CreationCanvas sessionId="brain-execution-detail-test" persistence="local" />);

    const toggle = screen.getByRole('button', { name: 'Show execution steps' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Hide execution steps' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('builderforce:create:brain-dock')!)).toMatchObject({ showExecutionDetail: true });
  });

  it('opens the Brain chat and shows canvas-global working feedback as soon as a prompt is submitted', () => {
    const { container } = render(<CreationCanvas sessionId="composer-opens-brain-test" persistence="local" />);

    fireEvent.change(screen.getByLabelText('Ask Brain about this canvas'), { target: { value: 'Show which agents are active' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Brain' }));

    expect(screen.getByRole('log', { name: 'Brain chat history' })).toBeInTheDocument();
    expect(screen.getAllByText('Show which agents are active').length).toBeGreaterThan(0);
    const working = container.querySelector('[data-variant="composer"][data-state="running"]');
    expect(working).toBeInTheDocument();
    expect(working).toHaveTextContent('Thinking…');
    expect(working).toHaveTextContent(/\d+s/);
  });

  // A local draft cannot execute anything: it is not linked to a runnable
  // definition and there is no account to own one. Running it used to wait
  // 1400ms and then report a `delivered` workflow-run from provider
  // `browser-draft` with `validation: passed` — a success nothing observed. Run
  // must now surface the real precondition instead of simulating a result.
  it('runs workflows from the workflow widget, and never fabricates a local run', async () => {
    render(<CreationCanvas sessionId="workflow-widget-run-test" persistence="local" />);

    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run Fall campaign workflow' }));

    expect(await screen.findByText('Save this workflow')).toBeInTheDocument();
    expect(screen.queryByText('Workflow completed')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft workflow running locally…')).not.toBeInTheDocument();
  });

  it('gates durable guest actions with account creation while preserving local creation', () => {
    render(<CreationCanvas sessionId="account-gate-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Save & collaborate' }));
    expect(screen.getByRole('dialog', { name: 'Create an account to save and collaborate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create free account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now — keep creating locally' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ask Brain about this canvas')).toBeEnabled();

    // Sharing is deliberately NOT gated: a guest invites by link into a shared
    // free session, and signing up is offered as the way to KEEP that board, not
    // as the price of sharing it. This assertion used to expect an account gate
    // here; guest rooms superseded that, and the gate would now break the very
    // flow the share panel exists for.
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
    expect(screen.getByRole('dialog', { name: 'Invite collaborators' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Create an account/ })).not.toBeInTheDocument();
  });

  it('closes the invitation panel from its dedicated close control', () => {
    render(<CreationCanvas sessionId="close-invitation-panel-test" persistence="local" initialShareOpen />);

    expect(screen.getByRole('dialog', { name: 'Invite collaborators' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close invitation panel' }));

    expect(screen.queryByRole('dialog', { name: 'Invite collaborators' })).not.toBeInTheDocument();
  });

  it('edits and runs a canonical workflow in an isolated Canvas focus editor', () => {
    render(<CreationCanvas sessionId="workflow-focus-test" persistence="local" />);
    fireEvent.click(screen.getByText('Fall campaign workflow'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Workflow on Canvas' }));

    expect(screen.getByRole('dialog', { name: 'Workflow focus editor' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save embedded workflow' }));
    expect(screen.getByDisplayValue('Updated campaign workflow')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run embedded workflow' }));
    expect(screen.getByText('Workflow run 91 started')).toBeInTheDocument();
  });

  it('adds a selected object from the palette', () => {
    render(<CreationCanvas sessionId="palette-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Dataset' }));

    expect(screen.getByDisplayValue('Imported dataset.csv')).toBeInTheDocument();
  });

  it('uses the open object palette without duplicating Add in the header', () => {
    render(<CreationCanvas sessionId="palette-add-test" persistence="local" />);

    expect(screen.getByText('Add to canvas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Add' })).not.toBeInTheDocument();
  });

  it('collapses palette sections, reveals search matches, and retains the state', async () => {
    const first = render(<CreationCanvas sessionId="palette-collapse-test" persistence="local" />);
    const build = screen.getByRole('button', { name: /Build section/ });
    fireEvent.click(build);
    expect(build).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Workflow' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search everything…' }), { target: { value: 'Workflow' } });
    expect(screen.getByRole('button', { name: 'Workflow' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.queryByRole('button', { name: 'Workflow' })).not.toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('builderforce:create:palette-collapsed-groups')).toContain('Build'));

    first.unmount();
    render(<CreationCanvas sessionId="palette-collapse-reopen-test" persistence="local" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Build section/ })).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByRole('button', { name: 'Workflow' })).not.toBeInTheDocument();
  });

  it('turns an AI request into a connected evaluation object', async () => {
    render(<CreationCanvas sessionId="evaluation-test" persistence="local" />);

    fireEvent.change(screen.getByLabelText('Ask Brain about this canvas'), { target: { value: 'Evaluate the selected canvas objects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Brain' }));
    await waitFor(() => expect(screen.getByDisplayValue('Canvas evaluation')).toBeInTheDocument(), { timeout: 2_000 });
    expect(screen.getByText('Evaluation added to canvas')).toBeInTheDocument();
  });

  it('expands optional project context into related live objects', () => {
    render(<CreationCanvas sessionId="project-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add all related items' }));

    expect(screen.getByText('Project relationships added to canvas')).toBeInTheDocument();
    expect(screen.getByDisplayValue('BuilderForce launch')).toBeInTheDocument();
  });

  it('creates feature mockups and dispatches their delivery from the session', async () => {
    render(<CreationCanvas sessionId="feature-test" persistence="local" />);
    fireEvent.change(screen.getByLabelText('Ask Brain about this canvas'), { target: { value: 'Create a visual summary of the top 10 requested features and mockups' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Brain' }));
    await waitFor(() => expect(screen.getByDisplayValue('Top 10 feature mockups')).toBeInTheDocument(), { timeout: 2_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Add to project and assign' }));
    expect(screen.getByRole('dialog', { name: 'Create an account to deliver this mockup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create free account' })).toBeInTheDocument();
  });

  it('edits a website prototype live from the inspector', () => {
    render(<CreationCanvas sessionId="website-editor-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Build the future together' } });
    fireEvent.change(screen.getByLabelText('Call to action'), { target: { value: 'Start building' } });
    fireEvent.change(screen.getByLabelText('Accent color'), { target: { value: '#d946ef' } });
    expect(screen.getByText('Build the future together')).toBeInTheDocument();
    expect(screen.getByText('Start building')).toHaveStyle({ background: '#d946ef' });
  });

  it('renders authored WYSIWYG pages instead of the fixed ecommerce mock', () => {
    const onEditData = vi.fn();
    render(<CreationNode
      id="acme-site" type="creation" selected={false} dragging={false} zIndex={0}
      selectable deletable draggable isConnectable positionAbsoluteX={0} positionAbsoluteY={0}
      onEditData={onEditData}
      data={{ kind: 'website', title: 'Acme Analytics', websiteTheme: { style: 'technical', accent: '#28c9b7' }, pages: [
        { id: 'home', name: 'Home', path: '/', sections: [
          { id: 'hero', kind: 'hero', eyebrow: 'Operational intelligence', heading: 'Turn operational data into confident decisions', body: 'One decision layer for every operator.', cta: 'Book a demo' },
          { id: 'features', kind: 'features', heading: 'Clarity at operating speed', items: [{ title: 'Live signals', body: 'See risk while there is time to act.' }] },
        ] },
        { id: 'about', name: 'About', path: '/about', sections: [
          { id: 'about-hero', kind: 'hero', heading: 'Built for operators', body: 'We turn noisy systems into clear decisions.', cta: 'Meet the team' },
          { id: 'principles', kind: 'content', heading: 'Our principles', body: 'Evidence before instinct.' },
        ] },
      ] }}
    />);

    expect(screen.getByText('Turn operational data into confident decisions')).toBeInTheDocument();
    expect(screen.getByText('Live signals')).toBeInTheDocument();
    expect(screen.queryByText('Free shipping')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(screen.getByText('Built for operators')).toBeInTheDocument();
    expect(onEditData).toHaveBeenCalledWith('acme-site', { activeWebsitePageId: 'about' });
  });

  it('resizes website viewport presets and renders supporting copy as Markdown', () => {
    render(<CreationCanvas sessionId="website-responsive-test" persistence="local" />);
    fireEvent.click(screen.getAllByText('Campaign landing page')[0]!);
    fireEvent.change(screen.getByLabelText('Supporting copy'), { target: { value: '**Secure banking** with transparent pricing.' } });
    expect(screen.getByText('Secure banking').tagName).toBe('STRONG');
    fireEvent.change(screen.getByLabelText('Viewport'), { target: { value: 'mobile' } });
    expect(screen.getByLabelText('Viewport')).toHaveValue('mobile');
    const previewNode = document.querySelector('article[data-viewport="mobile"]');
    expect(previewNode).toHaveStyle({ width: '340px', height: '620px' });
  });

  it('renders every imported row with success and failure highlighting', () => {
    const props = {
      type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
      selectable: true, deletable: true, draggable: true, isConnectable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
    };
    render(<CreationNode {...props} id="table-card" data={{
      kind: 'table', title: 'Shipment outcomes',
      columns: ['Shipment ID', 'Status'],
      rows: [
        { 'Shipment ID': 'SHP-1', Status: 'Success' },
        { 'Shipment ID': 'SHP-2', Status: 'Failure' },
        { 'Shipment ID': 'SHP-3', Status: 'Success' },
      ],
      rowCount: 3,
      highlightRules: [
        { column: 'Status', op: 'eq', value: 'Failure', tone: 'danger' },
        { column: 'Status', op: 'eq', value: 'Success', tone: 'success' },
      ],
    }} />);

    expect(screen.getByText('3 rows · 2 columns')).toBeInTheDocument();
    const grid = within(screen.getByRole('region', { name: 'Shipment outcomes' }));
    expect(grid.getByText('SHP-2')).toBeInTheDocument();
    expect(grid.getAllByText('Failure').filter((cell) => cell.getAttribute('data-tone') === 'danger')).toHaveLength(1);
    expect(grid.getAllByText('Success').filter((cell) => cell.getAttribute('data-tone') === 'success')).toHaveLength(2);
    // The legend summarises the same tones across every row, not just visible ones.
    const legend = screen.getAllByText('Success').filter((element) => element.querySelector('b'));
    expect(legend).toHaveLength(1);
    expect(legend[0]).toHaveTextContent('2');
  });

  it('previews an attached non-tabular file instead of showing an opaque card', () => {
    const props = {
      type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
      selectable: true, deletable: true, draggable: true, isConnectable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
    };
    render(<CreationNode {...props} id="file-card" data={{
      kind: 'file', title: 'notes.md', fileName: 'notes.md', mimeType: 'text/markdown', fileSize: 2048,
      content: '# Release notes\nShipment portal export',
    }} />);

    expect(screen.getByText('text/markdown')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText(/Shipment portal export/)).toBeInTheDocument();
  });

  it('draws a generated mesh on the object instead of pointing an image at the STL', () => {
    const props = {
      type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
      selectable: true, deletable: true, draggable: true, isConnectable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
    };
    const artifact = buildBrowserCreativeArtifact({ kind: 'model3d', title: 'Bracket' });
    const { rerender } = render(<CreationNode {...props} id="model-card" data={{
      kind: 'model3d', title: 'Bracket', status: 'Generated', outputUrl: artifact.url,
    }} />);
    // An STL is not an image, so the tile must not try to load it as one.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    rerender(<CreationNode {...props} id="model-card" data={{
      kind: 'model3d', title: 'Bracket', status: 'Generated', outputUrl: artifact.url, thumbnailUrl: artifact.previewImageUrl,
    }} />);
    expect(screen.getByRole('img', { name: 'Bracket preview' })).toHaveAttribute('src', artifact.previewImageUrl);
  });

  it('imports tabular data and creates a connected visualization', async () => {
    render(<CreationCanvas sessionId="dataset-visual-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dataset' }));
    const file = new File(['Region,Revenue\nNorth,120\nSouth,90'], 'revenue.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('Region,Revenue\nNorth,120\nSouth,90') });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Import CSV, TSV, or JSON'), { target: { files: [file] } });
      await Promise.resolve();
    });
    expect(screen.getAllByText('2 rows · 2 columns').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Create visualization' }));
    expect(screen.getByDisplayValue('revenue.csv visualization')).toBeInTheDocument();
    expect(screen.getAllByText('North').length).toBeGreaterThan(0);
  });

  it('designs Evermind creation and training as a canvas-native pipeline', () => {
    render(<CreationCanvas sessionId="evermind-pipeline-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Evermind' }));

    expect(screen.getByDisplayValue('Untitled Evermind')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Knowledge map with 0 learned contributions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recently learned' })).toHaveTextContent('Nothing learned yet');
    expect(screen.getByText('Hippocampus')).toBeInTheDocument();
    expect(screen.getByText(/blueprint works without an account/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start guided setup' }));

    expect(screen.getByText(/Step 1 of 5.*choose a CSV or TSV/i)).toBeInTheDocument();
    expect(screen.getByText('Tokenize examples')).toBeInTheDocument();
    expect(screen.getByText('Distil & tune')).toBeInTheDocument();
    expect(screen.getByText('Quality gate')).toBeInTheDocument();
    expect(screen.getByText('Learning telemetry')).toBeInTheDocument();
  });

  it('projects canonical active-project Evermind state onto a persisted canvas node', () => {
    const head: ProjectEvermindHead = { version: 9722, ref: 'evermind/project/30/v9722', mode: 'connected', name: 'Project Evermind', contributions: 17_112, inferenceEnabled: false, teacherModel: null, lastLearnedAt: '2026-08-03T02:33:51.127Z', seeded: true, quarantinedAt: '2026-07-26T16:10:30.453Z', quarantineReason: 'coherence probe failed' };
    const activity = {
      version: 9722, seeded: true, mode: 'connected', contributions: 17_112, inferenceEnabled: false, teacherModel: null,
      lastLearnedAt: head.lastLearnedAt, pending: 0, recent: [{ id: 1, kind: 'text' as const, version: 9722, at: Date.now(), weight: 0.4, prompt: 'Active project task', text: 'Learned result', skipReason: 'not_pinned' }],
      training: [{ version: 9722, at: Date.now(), loss: 3.2246, seqs: 10, moved: 42, deltaNorm: .2, merged: 1 }],
      eval: { version: 9722, at: Date.now(), baseLoss: 3.3164, newLoss: 3.2246, delta: .0918, evalSize: 6 },
      affect: { state: { valence: 0, arousal: 0, driveCuriosity: 0, driveCaution: 0, driveEffort: 0, driveSocial: 0, attention: 0, exploration: 0 }, setpoints: { valence: 0, arousal: 0, driveCuriosity: 0, driveCaution: 0, driveEffort: 0, driveSocial: 0, attention: 0, exploration: 0 }, attentionGain: 0, exploreBias: 0 },
      quarantinedAt: head.quarantinedAt, quarantineReason: head.quarantineReason,
    } satisfies ProjectEvermindContributions;

    const patch = projectEvermindNodePatch(head, activity);
    expect(patch).toMatchObject({ evermindVersion: 9722, contributions: 17_112, learningMode: 'connected', inferenceEnabled: false, trainingLoss: 3.2246, quarantinedAt: head.quarantinedAt });
    render(<CreationNode id="live-evermind" type="creation" data={{ kind: 'evermind', title: 'EverMind', ...patch }} selected={false} dragging={false} zIndex={0} selectable deletable draggable isConnectable positionAbsoluteX={0} positionAbsoluteY={0} />);
    expect(screen.getAllByText('v9722').length).toBeGreaterThan(0);
    expect(screen.getByText('17112')).toBeInTheDocument();
    expect(screen.getAllByText('Active project task').length).toBeGreaterThan(0);
    expect(screen.getByText('Quarantined — run readiness first')).toBeInTheDocument();
  });

  it('keeps anonymous object comments unblocked as a save-later collaboration step', () => {
    render(<CreationCanvas sessionId="local-comment-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));

    expect(screen.getByText('Collaboration starts when you save')).toBeInTheDocument();
    expect(screen.getByText(/Sign in to add comments, mentions, shared activity/i)).toBeInTheDocument();
  });

  it('requires two canonical projects before creating a live comparison', () => {
    render(<CreationCanvas sessionId="comparison-gate-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare projects on canvas' }));

    expect(screen.getByRole('dialog', { name: 'Create an account to compare projects' })).toBeInTheDocument();
  });

  it('gathers staff and agents into an impromptu stand-up frame', () => {
    render(<CreationCanvas sessionId="standup-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Stand-up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gather and start stand-up' }));

    expect(screen.getByRole('dialog', { name: 'Create an account to start a collaborative stand-up' })).toBeInTheDocument();
    expect(screen.getAllByText('Sarah').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Campaign Strategist').length).toBeGreaterThan(0);
  });

  it('adds a reusable Marketplace object pack to the session', () => {
    render(<CreationCanvas sessionId="template-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.click(screen.getByRole('button', { name: /Product discovery/i }));

    expect(screen.getByText('Product discovery added from Marketplace')).toBeInTheDocument();
    expect(screen.getByText('Customer feedback')).toBeInTheDocument();
    expect(screen.getByText('Opportunity evaluation')).toBeInTheDocument();
  });

  it('customizes and saves a reusable spatial frame', () => {
    render(<CreationCanvas sessionId="frame-preset-test" persistence="local" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Frame' }).find((button) => button.getAttribute('draggable') === 'true')!);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Decision review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as reusable frame' }));
    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));

    expect(screen.getByText('Reusable frame saved to your template library')).toBeInTheDocument();
    expect(screen.getByText('Your reusable frames')).toBeInTheDocument();
    expect(screen.getByText('Private custom frame')).toBeInTheDocument();
  });

  it('renders frame colors and drawing stroke settings live', () => {
    render(<CreationCanvas sessionId="spatial-settings-test" persistence="local" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Frame' }).find((button) => button.getAttribute('draggable') === 'true')!);
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Architecture review' } });
    fireEvent.change(screen.getByLabelText('Fill color'), { target: { value: '#123456' } });
    fireEvent.change(screen.getByLabelText('Border color'), { target: { value: '#abcdef' } });
    const purpose = screen.getByText('Architecture review');
    expect(purpose.closest('article')).toHaveStyle({ background: '#123456', borderColor: '#abcdef' });

    fireEvent.click(screen.getByRole('button', { name: 'Drawing' }));
    fireEvent.change(screen.getByLabelText('Stroke color'), { target: { value: '#ff0000' } });
    fireEvent.change(screen.getByLabelText('Stroke width'), { target: { value: '9' } });
    expect(screen.getByText('9 px')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sketch' })).toHaveStyle({ color: '#ff0000' });
  });

  it('keeps the session header focused and moves object commands into contextual controls', () => {
    render(<CreationCanvas sessionId="header-test" persistence="local" />);

    expect(screen.getByRole('button', { name: 'More session actions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Templates' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Fall campaign workflow'));
    expect(screen.getByLabelText('Selection actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
  });

  it('exposes one-paste Canvas and Session chat diagnostics', () => {
    render(<CreationCanvas sessionId="diagnostics-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Canvas diagnostics' }));
    expect(screen.getByLabelText('Canvas diagnostics')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Canvas diagnostics' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    expect(screen.getByRole('button', { name: 'Copy Session chat diagnostics' })).toBeInTheDocument();
  });

  it('opens and closes the accessible outline from the canvas command rail', () => {
    render(<CreationCanvas sessionId="accessible-graph-test" persistence="local" />);

    // The outline is off the board until asked for, and reachable from the same
    // rail as zoom/fit rather than floating permanently over the canvas.
    expect(screen.queryByRole('complementary', { name: 'Accessible canvas outline' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Accessible canvas outline' })[0]!);

    expect(screen.getByRole('complementary', { name: 'Accessible canvas outline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus Fall campaign workflow' })).toBeInTheDocument();
    expect(screen.getByText(/control connection to Campaign landing page: publishes/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Focus Campaign landing page' }));
    expect(screen.getByDisplayValue('Campaign landing page')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close canvas outline' }));
    expect(screen.queryByRole('complementary', { name: 'Accessible canvas outline' })).not.toBeInTheDocument();
  });

  it('copies the diagnostics report and opens the panel from one icon-only control', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CreationCanvas sessionId="diagnostics-copy-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Canvas diagnostics' }));

    expect(screen.getByLabelText('Canvas diagnostics')).toBeInTheDocument();
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0]![0])).toContain('Creation Canvas diagnostics');
    expect(toasts.success).toHaveBeenCalledWith('Diagnostics copied to your clipboard');
  });

  it('says so when the diagnostics report cannot be assembled, instead of failing silently', async () => {
    // The rejection used to escape into `void openDiagnostics()`: no report, no toast,
    // no console — indistinguishable from a button that was never wired up.
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    capture.failWith = 'version probe exploded';
    render(<CreationCanvas sessionId="diagnostics-failure-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Canvas diagnostics' }));

    // The panel still opens: the state on screen is itself half the diagnosis.
    expect(screen.getByLabelText('Canvas diagnostics')).toBeInTheDocument();
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(String(toasts.error.mock.calls[0]![0])).toContain('version probe exploded');
    expect(writeText).not.toHaveBeenCalled();
  });
});
