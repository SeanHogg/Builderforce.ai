// @vitest-environment jsdom
/** Search past the loaded graph, Trace from the node panel, finding rows, and the compact (phone) view. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { PHONE_FOCUS_NODES } from './graphModel';
import { codeFixture, docsFixture, fixtureSource } from './testing';
import type { KnowledgeGraphSource, KnowledgeSearchHit } from './types';

vi.mock('./scene/GraphScene', () => ({ default: () => null }));

afterEach(() => vi.restoreAllMocks());

const search = (q: string) => {
  const box = screen.getByRole('searchbox', { name: L.searchLabel });
  fireEvent.change(box, { target: { value: q } });
  fireEvent.submit(box.closest('form')!);
};

describe('search beyond the loaded graph', () => {
  const hidden: KNode = { ref: 'src:docs::deep/hidden.md', kind: 'file', label: 'deep/hidden.md', pack: 'docs', importance: 0.01, origin: 'extracted' } as KNode;
  const loaded = docsFixture();
  const full: KnowledgeGraph = { ...loaded, nodes: [...loaded.nodes, hidden] };

  function source(hits: KnowledgeSearchHit[]) {
    const load = vi.fn(async (_root: string, q?: { focus?: string[] }) => (q?.focus ? full : loaded));
    const searchApi = vi.fn(async () => hits);
    return { load, searchApi, src: { ...fixtureSource([loaded]), load, search: searchApi } as KnowledgeGraphSource };
  }

  it('reloads with the hit as focus when it is not in the loaded graph, then selects it', async () => {
    const { load, searchApi, src } = source([{ ref: hidden.ref, score: 1, tier: 'bm25' }]);
    render(<div style={{ height: 600 }}><KnowledgeGraphView source={src} /></div>);
    await screen.findByTestId('kg-list');
    expect(load).toHaveBeenCalledTimes(1);

    search('hidden');
    const panel = await screen.findByRole('dialog');
    expect(searchApi).toHaveBeenCalledWith('docs', 'hidden');
    expect(load).toHaveBeenLastCalledWith('docs', { focus: [hidden.ref] });
    expect(within(panel).getAllByText('deep/hidden.md').length).toBeGreaterThan(0);
  });

  it('does not reload when every hit is already in the loaded graph', async () => {
    const inGraph = loaded.nodes.find((n) => n.label === 'lease.md')!;
    const { load, src } = source([{ ref: inGraph.ref, score: 1, tier: 'exact' }]);
    render(<div style={{ height: 600 }}><KnowledgeGraphView source={src} /></div>);
    await screen.findByTestId('kg-list');

    search('lease');
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getAllByText('lease.md').length).toBeGreaterThan(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the loaded graph and still focuses the hit when the reload fails', async () => {
    const { load, src } = source([{ ref: hidden.ref, score: 1, tier: 'bm25' }]);
    render(<div style={{ height: 600 }}><KnowledgeGraphView source={src} /></div>);
    await screen.findByTestId('kg-list');
    load.mockRejectedValueOnce(new Error('offline'));

    search('hidden');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('kg-list')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('finding rows', () => {
  it('names the sections a contradiction sets against each other', async () => {
    const graph = docsFixture();
    const withParams: KnowledgeGraph = {
      ...graph,
      findings: graph.findings.map((f) => (f.kind === 'contradiction'
        ? { ...f, params: { fileA: 'lease.md', sectionA: '2', fileB: 'policy.md', sectionB: '', confidence: 80 } }
        : f)),
    };
    const onCompose = vi.fn();
    render(<div style={{ height: 600 }}><KnowledgeGraphView source={fixtureSource([withParams])} onCompose={onCompose} /></div>);
    await screen.findByTestId('kg-list');
    const row = document.querySelector('[data-finding="contradiction"]') as HTMLElement;
    expect(within(row).getByText('Reconcile §2 of lease.md with policy.md.')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: L.fixWithAgent }));
    expect(onCompose).toHaveBeenCalledWith('Reconcile §2 of lease.md with policy.md.');
  });

  it('asks to consolidate a clone group without a dangling "clone group :" when the group is unnamed', async () => {
    const graph = codeFixture();
    const unnamed: KnowledgeGraph = {
      ...graph,
      findings: graph.findings.map((f) => (f.kind === 'clone-group' ? { ...f, params: { group: '', members: 2 } } : f)),
    };
    const onCompose = vi.fn();
    render(<div style={{ height: 600 }}><KnowledgeGraphView source={fixtureSource([unnamed])} onCompose={onCompose} /></div>);
    await screen.findByTestId('kg-list');
    const row = document.querySelector('[data-finding="clone-group"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: L.fixWithAgent }));
    const text = onCompose.mock.calls[0]![0] as string;
    expect(text).not.toContain('clone group');
    expect(text).toContain('Consolidate the duplicated code: ');
  });
});

describe('Trace from the node panel', () => {
  it('opens the trace for the selected node, in the catalog\'s words for edge kinds', async () => {
    render(
      <div style={{ height: 600 }}>
        <KnowledgeGraphView source={fixtureSource([codeFixture()])} labels={{ edgeKinds: { references: 'verweist auf' } }} />
      </div>,
    );
    const list = await screen.findByTestId('kg-list');
    fireEvent.click(within(list).getByRole('button', { name: /app\/page\.tsx/ }));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).queryByRole('img', { name: L.traceTitle })).toBeNull();

    fireEvent.click(within(panel).getByRole('button', { name: L.trace }));
    const trace = await within(panel).findByRole('img', { name: L.traceTitle });
    expect(trace.textContent).toContain('verweist auf');
    expect(trace.textContent).not.toContain('references');
    // Code lanes are partitions; the pack is worded, not an id.
    expect(within(panel).getByText(L.packs.code)).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: L.trace }));
    expect(within(panel).queryByRole('img', { name: L.traceTitle })).toBeNull();
  });
});

describe('compact (phone) view', () => {
  const big = (): KnowledgeGraph => {
    const base = docsFixture('big');
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      ref: `src:big::n${String(i).padStart(3, '0')}.md`, kind: 'file', label: `n${String(i).padStart(3, '0')}.md`, pack: 'docs',
      importance: 1 - i / 200, origin: 'extracted',
    }) as KNode);
    return { ...base, nodes, edges: [], findings: [], stats: { sources: 100, nodes: 100, edges: 0, stale: 0, truncated: false } };
  };
  const narrow = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 640, top: 0, left: 0, right: 360, bottom: 640, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  const rows = () => [...screen.getByTestId('kg-list').querySelectorAll('button[aria-pressed]')] as HTMLElement[];

  it('opens on the top 60 nodes, says so, and Show all reveals the rest', async () => {
    narrow();
    render(<div style={{ height: 640 }}><KnowledgeGraphView source={fixtureSource([big()])} /></div>);
    await screen.findByTestId('kg-list');
    expect(rows()).toHaveLength(PHONE_FOCUS_NODES);
    expect(rows().map((r) => r.querySelectorAll('span')[1]!.textContent)).toContain('n000.md');
    expect(rows().map((r) => r.querySelectorAll('span')[1]!.textContent)).not.toContain('n099.md');
    expect(screen.getByText(/Showing the top 60 nodes\./)).toBeTruthy();

    const showAll = screen.getByRole('button', { name: L.showAll });
    expect(showAll.style.minHeight).toBe('40px');
    fireEvent.click(showAll);
    expect(rows()).toHaveLength(100);
    expect(screen.queryByRole('button', { name: L.showAll })).toBeNull();
  });

  it('keeps tap targets at 40px and opens a node as a bottom sheet', async () => {
    narrow();
    render(<div style={{ height: 640 }}><KnowledgeGraphView source={fixtureSource([big()])} /></div>);
    await screen.findByTestId('kg-list');
    expect(rows()[0]!.style.minHeight).toBe('40px');
    fireEvent.click(rows()[0]!);
    const sheet = await screen.findByRole('dialog');
    expect(sheet.style.left).toBe('0px');
    expect(sheet.style.right).toBe('0px');
    expect(sheet.style.bottom).toBe('0px');
    expect(sheet.style.top).toBe('');
  });

  it('opens a node as a side panel on a wide container, and shows every node', async () => {
    render(<div style={{ height: 640 }}><KnowledgeGraphView source={fixtureSource([big()])} /></div>);
    await screen.findByTestId('kg-list');
    expect(rows()).toHaveLength(100);
    expect(screen.queryByRole('button', { name: L.showAll })).toBeNull();
    fireEvent.click(rows()[0]!);
    const sheet = await screen.findByRole('dialog');
    expect(sheet.style.top).toBe('0px');
    expect(sheet.style.right).toBe('0px');
    expect(sheet.style.left).toBe('');
  });
});
