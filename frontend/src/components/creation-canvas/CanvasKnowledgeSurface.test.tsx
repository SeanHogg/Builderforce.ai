import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphSource } from '@builderforce/knowledge-graph-view';

// The browser source (API client, worker review, IndexedDB) is covered in its own package;
// here it is a stand-in, so what is under test is what THIS surface wires: the project it
// builds the source for, the labels, the chip intent from the URL, the composer, Escape.
const mocks = vi.hoisted(() => {
  const judgeEstimate = vi.fn(async () => ({ perCallUsd: 0.01, model: 'm', local: false }));
  return {
    createKnowledgeSource: vi.fn(), judgeEstimate, providers: vi.fn(async () => []),
    createClient: vi.fn((_projectId?: number) => ({ judgeEstimate })),
  };
});
vi.mock('@builderforce/knowledge-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@builderforce/knowledge-browser')>()),
  createKnowledgeSource: mocks.createKnowledgeSource,
}));
vi.mock('@/lib/knowledge/webKnowledgeClient', () => ({ createWebKnowledgeClient: mocks.createClient }));
vi.mock('@/lib/knowledge/webDirectoryProviders', () => ({ webDirectoryProviders: mocks.providers }));

import { CanvasKnowledgeSurface } from './CanvasKnowledgeSurface';

const REF = 'src:p::a.md';
const GRAPH = {
  scope: { rootId: 'p', packs: ['docs'], digest: 'd' },
  nodes: [{ ref: REF, kind: 'file', label: 'a.md', pack: 'docs', importance: 1, origin: 'extracted' }],
  edges: [],
  findings: [{ id: 'orphan:a', kind: 'orphan', pack: 'docs', nodes: [REF], severity: 'info', params: { count: 1 }, requestKey: 'knowledgeGraph.fix.orphan' }],
  stats: { sources: 1, nodes: 1, edges: 0, stale: 0, truncated: false },
} as unknown as KnowledgeGraph;

function stubSource(graphs: KnowledgeGraph[]) {
  const load = vi.fn(async (_rootId: string, _q?: { focus?: string[] }) => graphs[0] ?? null);
  const source: KnowledgeGraphSource = {
    scopes: async () => graphs.map((g) => ({ rootId: g.scope.rootId, title: g.scope.rootId, packs: g.scope.packs })),
    load,
    review: () => (async function* () { /* never reviews here */ })(),
  };
  mocks.createKnowledgeSource.mockReturnValue(source);
  return { source, load };
}

beforeEach(() => {
  mocks.createKnowledgeSource.mockReset();
  window.history.replaceState(null, '', '/');
});
afterEach(() => window.history.replaceState(null, '', '/'));

describe('CanvasKnowledgeSurface', () => {
  it("prices the confirm chip from the SERVER's estimate through the same client", async () => {
    stubSource([GRAPH]);
    render(<CanvasKnowledgeSurface projectId={7} onExit={vi.fn()} />);
    await screen.findByTestId('kg-list');
    const options = mocks.createKnowledgeSource.mock.calls[0]![0] as { callPrice(): Promise<unknown> };
    expect(await options.callPrice()).toEqual({ perCallUsd: 0.01, model: 'm', local: false });
    expect(mocks.judgeEstimate).toHaveBeenCalledTimes(1);
  });

  it('builds the shared browser source for the board\'s project and renders the graph view in its region', async () => {
    stubSource([GRAPH]);
    render(<CanvasKnowledgeSurface projectId={7} onExit={vi.fn()} />);

    const region = screen.getByTestId('canvas-knowledge-surface');
    expect(region.getAttribute('aria-label')).toBe('creationCanvas.surface.knowledge.regionLabel');
    expect(await screen.findByTestId('kg-list')).toBeTruthy();
    expect(screen.getAllByText('a.md').length).toBeGreaterThan(0);

    expect(mocks.createClient).toHaveBeenCalledWith(7);
    const options = mocks.createKnowledgeSource.mock.calls[0]![0] as { projectId: number; directorySources(): Promise<unknown[]> };
    expect(options.projectId).toBe(7);
    await options.directorySources();
    expect(mocks.providers).toHaveBeenCalledWith({ projectId: 7, workspaceTitle: 'creationCanvas.surface.knowledge.workspaceTitle' });
  });

  it('explains itself and builds no source when the board has no project', () => {
    render(<CanvasKnowledgeSurface projectId={null} onExit={vi.fn()} />);
    expect(mocks.createKnowledgeSource).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('creationCanvas.surface.knowledge.noProjectTitle');
    expect(screen.getByRole('status').textContent).toContain('creationCanvas.surface.knowledge.noProjectBody');
    expect(screen.queryByTestId('kg-list')).toBeNull();
  });

  it('shows the view\'s own empty state, with Review a folder, for a project with nothing reviewed', async () => {
    stubSource([]);
    render(<CanvasKnowledgeSurface projectId={7} onExit={vi.fn()} />);
    // Labels fall back to the English defaults when the catalog hands back its own key.
    expect(await screen.findByText('No folder reviewed yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review a folder' })).toBeTruthy();
  });

  it('opens on the refs a knowledge chip carried in the URL', async () => {
    window.history.replaceState(null, '', `/?surface=knowledge&kgFocus=${encodeURIComponent(JSON.stringify([REF]))}`);
    const { load } = stubSource([GRAPH]);
    render(<CanvasKnowledgeSurface projectId={7} onExit={vi.fn()} />);
    await screen.findByTestId('kg-list');
    expect(load).toHaveBeenCalledWith('p', { focus: [REF] });
  });

  it('opens on the review launcher when the chip asked to choose a folder', async () => {
    window.history.replaceState(null, '', '/?surface=knowledge&kgReview=1');
    stubSource([]);
    render(<CanvasKnowledgeSurface projectId={7} onExit={vi.fn()} />);
    const launcher = await screen.findByRole('button', { name: 'Review a folder' });
    await waitFor(() => expect(document.activeElement).toBe(launcher));
  });

  it('hands Fix with agent to the canvas composer as a prefilled draft', async () => {
    stubSource([GRAPH]);
    const composeDraft = vi.fn();
    render(<CanvasKnowledgeSurface projectId={7} onExit={vi.fn()} composeDraft={composeDraft} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fix with agent' }));
    expect(composeDraft).toHaveBeenCalledTimes(1);
    expect(composeDraft.mock.calls[0]![0]).toContain('orphan documents');
    expect(composeDraft.mock.calls[0]![0]).toContain('a.md');
  });

  it('offers no Fix button without a composer', async () => {
    stubSource([GRAPH]);
    render(<CanvasKnowledgeSurface projectId={7} onExit={vi.fn()} />);
    await screen.findByTestId('kg-list');
    expect(screen.queryByRole('button', { name: 'Fix with agent' })).toBeNull();
  });

  it('leaves on Escape pressed on the surface itself, and not on Escape inside the view', async () => {
    stubSource([GRAPH]);
    const onExit = vi.fn();
    render(<CanvasKnowledgeSurface projectId={7} onExit={onExit} />);
    const region = screen.getByTestId('canvas-knowledge-surface');
    await screen.findByTestId('kg-list');
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
