import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreationCanvas } from './CreationCanvas';

/**
 * Builder objects — the in-browser website/app builder, on the Canvas.
 *
 * A Builder object owns a real IDE project: creating it provisions the project
 * through the same route the IDE dashboard uses, so the workspace is seeded with
 * the starter template its type selects, and opening it mounts the whole `<IDE>`
 * surface over the board.
 *
 * Deliberately its OWN file rather than another block inside `CreationCanvas.test.tsx`:
 * that suite is ~77 tests in one jsdom render and does not give a stable verdict
 * (see the Gap Register), so a new concern gets a new file it can fail honestly in.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));
const toasts = vi.hoisted(() => ({ show: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toasts }));

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
    // The board now draws remote cursors inside the viewport (`RemoteCursors`),
    // so the mock has to offer the portal — rendering children in place is all a
    // board test needs from it, and omitting it would crash any test that gives
    // the canvas a collaborator with a live pointer.
    ViewportPortal: ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'viewport-portal' }, children),
    Controls: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    ControlButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props, children),
    MiniMap: inert, Handle: inert, NodeResizer: inert,
    BackgroundVariant: { Dots: 'dots' }, MarkerType: { ArrowClosed: 'arrowclosed' }, Position: { Left: 'left', Right: 'right' },
    ConnectionMode: { Strict: 'strict', Loose: 'loose' },
  };
});

/**
 * By TESTID, not by role+name. Every palette entry carries
 * `data-testid="canvas-palette-<kind>"` for exactly this, and a name-filtered role
 * query has to build an accessible name for every button on a mounted canvas —
 * the whole palette — which is most of what these four tests were spending.
 */
function addBuilder() {
  fireEvent.click(screen.getByTestId('canvas-palette-build'));
}

// No suite-level timeout override — see the note in `CreationCanvas.test.tsx`:
// the 15s cap was a mitigation for a render loop that no longer exists, and it
// now only cuts off heavy mounts when this file runs alongside the rest of
// `src/components` rather than on its own.
describe('Builder objects on the Canvas', () => {
  it('offers exactly the IDE project types and reports that no workspace exists yet', () => {
    render(<CreationCanvas sessionId="builder-type-test" persistence="local" />);

    addBuilder();

    expect(screen.getAllByText('Not created').length).toBeGreaterThan(0);
    const chooser = screen.getByLabelText('What are you building') as HTMLSelectElement;
    expect(chooser).not.toBeDisabled();
    expect([...chooser.options].map((option) => option.value)).toEqual(
      ['designer', 'mobile', 'webmobile', 'video', 'evermind', 'finetune', 'voice'],
    );
    expect(chooser.value).toBe('designer');
    expect(screen.getByRole('button', { name: 'Create the workspace' })).toBeInTheDocument();
  });

  // The type is what selects the starter template server-side, so it has to reach
  // the object — a chooser that only moved local state would seed the wrong app.
  it('carries the chosen type onto the object', () => {
    render(<CreationCanvas sessionId="builder-modality-test" persistence="local" />);

    addBuilder();
    fireEvent.change(screen.getByLabelText('What are you building'), { target: { value: 'mobile' } });

    expect((screen.getByLabelText('What are you building') as HTMLSelectElement).value).toBe('mobile');
    expect(screen.getAllByText('Mobile').length).toBeGreaterThan(0);
  });

  // An IDE project is a tenant resource, so an anonymous draft has to be claimed
  // first rather than the button silently doing nothing.
  it('asks an anonymous session to create an account before provisioning a workspace', async () => {
    render(<CreationCanvas sessionId="builder-gate-test" persistence="local" />);

    addBuilder();
    fireEvent.click(screen.getByRole('button', { name: 'Create the workspace' }));

    const gate = await screen.findByRole('dialog', { name: 'Create an account to build' });
    expect(within(gate).getByText(/stored against your account/i)).toBeInTheDocument();
  });

  it('grows an authored Website into a connected Builder that builds a website', async () => {
    render(<CreationCanvas sessionId="builder-from-website-test" persistence="local" />);

    fireEvent.click(screen.getByTestId('canvas-palette-website'));
    fireEvent.click(screen.getByRole('button', { name: 'Build this site with code' }));

    await waitFor(() => expect(screen.getByText(/Builder added/)).toBeInTheDocument());
    expect((screen.getByLabelText('What are you building') as HTMLSelectElement).value).toBe('designer');
    expect(screen.getByTestId('flow').getAttribute('data-edge-pairs')).toMatch(/.+:.+/);
  });
});
