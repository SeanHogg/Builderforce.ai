// @vitest-environment jsdom
/**
 * What each lens DOES in the view (PRD 38 §3.3), read from what the 3D scene is handed and
 * what the aside lists — plus the legend, the judgement notice, the lens-not-applicable
 * note, and the list fallback showing the same nodes the scene draws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { LENSES, LENS_ORDER } from './lenses';
import type { LensDef } from './lenses';
import { codeFixture, docsFixture, fixtureSource, mixedFixture } from './testing';
import type { LensId } from './types';

interface SceneProps { nodes: KNode[]; edges: KEdge[]; lens: LensDef }
const scene = vi.hoisted(() => ({ props: null as SceneProps | null }));

// The WebGL scene is replaced by a recorder: what it is handed is what would be drawn.
vi.mock('./scene/GraphScene', () => ({
  default: (props: SceneProps) => { scene.props = props; return <div data-testid="kg-scene" />; },
}));

beforeEach(() => {
  scene.props = null;
  // A canvas that "has" WebGL, so the view takes the 3D path (the scene itself is mocked).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({})) as never);
});
afterEach(() => vi.restoreAllMocks());

async function mount3D(graph: KnowledgeGraph, props: Partial<Parameters<typeof KnowledgeGraphView>[0]> = {}) {
  render(<div style={{ height: 600 }}><KnowledgeGraphView source={fixtureSource([graph])} {...props} /></div>);
  await waitFor(() => expect(scene.props).not.toBeNull());
}

const lensButton = (id: LensId) => within(screen.getByRole('navigation', { name: L.lensesLabel })).getByRole('button', { name: L.lenses[id] });
async function pick(id: LensId) {
  fireEvent.click(lensButton(id));
  await waitFor(() => expect(scene.props!.lens.id).toBe(id));
}
const labelled = (label: string) => scene.props!.nodes.find((n) => n.label === label)!;
const style = (label: string) => scene.props!.lens.nodeStyle(labelled(label));
const asideKinds = () => [...document.querySelectorAll('aside[aria-label="' + L.findingsTitle + '"] [data-finding]')].map((el) => el.getAttribute('data-finding')).sort();
const kinds = (edges: KEdge[]) => [...new Set(edges.map((e) => e.kind))].sort();

describe('lens effects on the 3D scene', () => {
  const graph = mixedFixture();

  it('draws every node under every lens, and only the edges the lens keeps', async () => {
    await mount3D(graph);
    const expected: Record<LensId, { count: number; kinds: string[] }> = {
      structure: { count: 9, kinds: ['contains', 'links', 'references'] },
      partitions: { count: 6, kinds: ['references'] },
      duplication: { count: 1, kinds: ['duplicate'] },
      claims: { count: 4, kinds: ['about', 'contradicts'] },
      links: { count: 2, kinds: ['links'] },
      unused: { count: 6, kinds: ['references'] },
      knowledge: { count: 3, kinds: ['about'] },
      live: { count: 0, kinds: [] },
      compare: { count: graph.edges.length, kinds: kinds(graph.edges) },
    };
    for (const id of LENS_ORDER) {
      await pick(id);
      expect(scene.props!.nodes.length, id).toBe(graph.nodes.length);
      expect(scene.props!.edges.length, id).toBe(expected[id].count);
      expect(kinds(scene.props!.edges), id).toEqual(expected[id].kinds);
    }
  });

  it('tones nodes the way each lens means', async () => {
    await mount3D(graph);
    await pick('duplication');
    expect(style('app/billing.tsx')).toEqual({ tone: 'duplicate', emphasis: 'strong' });
    expect(style('app/page.tsx').emphasis).toBe('dim');

    await pick('claims');
    expect(style('Notice is 30 days').emphasis).toBe('strong');
    expect(style('policy/termination.md').emphasis).toBe('dim');

    await pick('links');
    expect(style('missing.md')).toEqual({ tone: 'nodeMissing', emphasis: 'strong' });
    expect(style('app/page.tsx').emphasis).toBe('normal');

    await pick('unused');
    expect(style('infrastructure/legacy.ts')).toEqual({ tone: 'unused', emphasis: 'strong' });
    expect(style('app/page.tsx').emphasis).toBe('dim');

    await pick('knowledge');
    expect(style('Legal owns the lease').emphasis).toBe('strong');
    expect(style('policy/termination.md').emphasis).toBe('dim');

    await pick('partitions');
    expect(style('domain/invoice.ts').emphasis).toBe('strong');
    expect(style('Notice is 30 days').emphasis).toBe('dim');

    await pick('live');
    expect(scene.props!.nodes.every((n) => scene.props!.lens.nodeStyle(n).emphasis === 'dim')).toBe(true);

    await pick('structure');
    expect(style('app/page.tsx').emphasis).toBe('normal');
    expect(style('Notice is 30 days').tone).toBe('nodeClaim');
  });

  it('surfaces each lens\' insights in the aside', async () => {
    await mount3D(graph);
    const expected: Record<LensId, string[]> = {
      structure: ['cycle', 'stale'],
      partitions: ['cycle', 'partition-violation', 'partition-violation'],
      duplication: ['clone-group'],
      claims: ['contradiction', 'stale'],
      links: ['broken-link', 'orphan'],
      unused: ['unused-file'],
      knowledge: ['stale'],
      live: [],
      compare: graph.findings.map((f) => f.kind).sort(),
    };
    for (const id of LENS_ORDER) {
      await pick(id);
      expect(asideKinds(), id).toEqual(expected[id]);
    }
  });
});

describe('legend and lens notes', () => {
  it('draws the active lens\' legend in the catalog\'s words', async () => {
    await mount3D(mixedFixture());
    for (const id of LENS_ORDER) {
      await pick(id);
      const legend = screen.getByTestId('kg-legend');
      expect(within(legend).getByRole('list')).toBeTruthy();
      const rows = [...legend.querySelectorAll('li[data-legend]')];
      expect(rows.map((r) => r.getAttribute('data-legend')), id).toEqual(LENSES[id].legend.map((row) => row.key));
      for (const row of LENSES[id].legend) expect(within(legend).getAllByText(L.legend[row.key]!).length, `${id}:${row.key}`).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText(L.legendLabel)).toBe(screen.getByTestId('kg-legend'));
  });

  it('says a lens does not apply when its packs are not in the folder, and shows the lens that does', async () => {
    await mount3D(codeFixture(), { initialLens: 'claims' });
    expect(screen.getByText(L.lensNotApplicable)).toBeTruthy();
    expect(scene.props!.lens.id).toBe('structure');
    expect(lensButton('structure').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows no such note for a lens that applies', async () => {
    await mount3D(mixedFixture(), { initialLens: 'claims' });
    expect(screen.queryByText(L.lensNotApplicable)).toBeNull();
  });

  it('explains Claims when nothing has been judged', async () => {
    const unjudged: KnowledgeGraph = { ...docsFixture(), nodes: docsFixture().nodes.filter((n) => n.origin === 'extracted'), edges: [], findings: [] };
    await mount3D(unjudged);
    await pick('claims');
    expect(screen.getByRole('note').textContent).toBe(L.lensNeedsJudgement);
  });

  it('does not show the judgement notice on a judged graph', async () => {
    await mount3D(docsFixture());
    await pick('claims');
    expect(screen.queryByText(L.lensNeedsJudgement)).toBeNull();
  });
});

describe('list fallback parity', () => {
  it('lists exactly the nodes the 3D scene draws, for each lens', async () => {
    await mount3D(mixedFixture());
    for (const id of ['structure', 'claims', 'live'] as const) {
      await pick(id);
      const drawn = scene.props!.nodes.map((n) => n.label).sort();
      fireEvent.click(screen.getByRole('button', { name: L.viewList }));
      const rows = [...screen.getByTestId('kg-list').querySelectorAll('button[aria-pressed]')];
      expect(rows.map((r) => r.querySelectorAll('span')[1]!.textContent).sort(), id).toEqual(drawn);
      fireEvent.click(screen.getByRole('button', { name: L.view3d }));
      await waitFor(() => expect(screen.getByTestId('kg-scene')).toBeTruthy());
    }
  });

  it('lists every finding of the graph, as the scene\'s lenses together do', async () => {
    const graph = mixedFixture();
    await mount3D(graph);
    fireEvent.click(screen.getByRole('button', { name: L.viewList }));
    const shown = [...screen.getByTestId('kg-list').querySelectorAll('[data-finding]')].map((el) => el.getAttribute('data-finding')).sort();
    expect(shown).toEqual(graph.findings.map((f) => f.kind).sort());
  });
});
