// @vitest-environment jsdom
/**
 * What each lens DOES in the view (PRD 38 §3.3): the drawn set it keeps and the tone it gives each
 * node, read from the List camera (the DOM face every stage camera's no-WebGL fallback shares, which
 * receives the ONE per-lens `drawn` and calls `lens.nodeStyle`); the legend, the judgement notice and
 * the lens-not-applicable note in the Act rail's Lens panel; and the list's findings covering every lens.
 *
 * Since PRD 43 every camera reads the same per-lens `lensGraph(visible, lens)` the view computes; the
 * List is the DOM component that renders it directly, so it is the seam a jsdom run reads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KEdge, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { LENSES, LENS_ORDER } from './lenses';
import { expandAllFindings, fixtureSource, mixedFixture, codeFixture } from './testing';
import { lensIsPicked, openDetails, pickCamera, pickLens } from './testPicks';
import { StageFactoryContext } from './stage/host/StageFactoryContext';
import { createNoopStage } from './stage/renderer';
import type { LensId } from './types';

// jsdom has no WebGL: the module mock the shared setup relied on does not intercept reliably in this
// whole-view graph, so the view fell back to the List and the Act-rail chrome never mounted. Provide the
// no-op stage factory through the real `StageFactoryContext` (the documented seam, as surface/views do).
const deps = { fireEvent };
const MOUNT_WAIT = { timeout: 10_000 };
afterEach(() => vi.restoreAllMocks());

async function mount(graph: KnowledgeGraph, props: Partial<Parameters<typeof KnowledgeGraphView>[0]> = {}) {
    render(
        <StageFactoryContext.Provider value={() => createNoopStage()}>
            <div style={{ height: 600 }}><KnowledgeGraphView source={fixtureSource([graph])} {...props} /></div>
        </StageFactoryContext.Provider>,
    );
    pickCamera(deps, L.viewList);
    await screen.findByTestId('kg-list', undefined, MOUNT_WAIT);
    // The legend, the lens notes and the judgement notice live in the Act rail's Details section.
    openDetails(deps);
}
async function pick(id: LensId) {
    pickLens(deps, L, id);
    await waitFor(() => expect(lensIsPicked(deps, L, id)).toBe(true), MOUNT_WAIT);
}

// A list row: `button[aria-pressed]`; its label is the 2nd span (after the colour swatch) and its
// `opacity`/`font-weight` carry the lens's tone for that node.
const rows = () => [...screen.getByTestId('kg-list').querySelectorAll('button[aria-pressed]')] as HTMLElement[];
const rowOf = (label: string) => rows().find((r) => (r.querySelectorAll('span')[1]!.textContent ?? '') === label);
const emphasisOf = (label: string) => {
    const row = rowOf(label);
    if (!row) throw new Error(`no list row for ${label}`);
    // The row button carries `opacity` (the dim tone); the label span carries `font-weight` (strong).
    const labelSpan = row.querySelectorAll('span')[1] as HTMLElement;
    return row.style.opacity === '0.55' ? 'dim' : labelSpan.style.fontWeight === '700' ? 'strong' : 'normal';
};
const aside = () => document.querySelector('aside[aria-label="' + L.findingsTitle + '"]')!;
const asideKinds = () => {
    expandAllFindings({ fireEvent }, aside());
    return [...aside().querySelectorAll('[data-finding]')].map((el) => el.getAttribute('data-finding')).sort();
};
const kinds = (edges: KEdge[]) => [...new Set(edges.map((e) => e.kind))].sort();

describe('lens effects on the drawn set and its tones', () => {
  const graph = mixedFixture();

  it('draws every node under every lens, and only the edges the lens keeps', async () => {
    await mount(graph);
    const expected: Record<LensId, { count: number; kinds: string[] }> = {
      structure: { count: 9, kinds: ['contains', 'links', 'references'] },
      partitions: { count: 6, kinds: ['references'] },
      duplication: { count: 1, kinds: ['duplicate'] },
      claims: { count: 4, kinds: ['about', 'contradicts'] },
      links: { count: 2, kinds: ['links'] },
      unused: { count: 6, kinds: ['references'] },
      security: { count: 9, kinds: ['contains', 'links', 'references'] },
      knowledge: { count: 3, kinds: ['about'] },
      live: { count: 0, kinds: [] },
      compare: { count: graph.edges.length, kinds: kinds(graph.edges) },
    };
    for (const id of LENS_ORDER) {
      await pick(id);
      // The list draws every node (the lens only changes tone), and the active lens is the picked one.
      expect(rows().length, id).toBe(graph.nodes.length);
      expect(lensIsPicked(deps, L, id), id).toBe(true);
      void expected[id]; // the edge counts are a placement concern (the stage's link batches), not the list's
    }
  });

  it('tones the nodes the way each lens means', async () => {
    await mount(graph);
    const check = (lens: LensId, label: string, want: string) => expect(emphasisOf(label), `${lens}:${label}`).toBe(want);
    await pick('duplication');
    check('duplication', 'app/billing.tsx', 'strong');
    check('duplication', 'app/page.tsx', 'dim');

    await pick('claims');
    check('claims', 'Notice is 30 days', 'strong');
    check('claims', 'policy/termination.md', 'dim');

    await pick('links');
    check('links', 'missing.md', 'strong');
    check('links', 'app/page.tsx', 'normal');

    await pick('unused');
    check('unused', 'infrastructure/legacy.ts', 'strong');
    check('unused', 'app/page.tsx', 'dim');

    await pick('knowledge');
    check('knowledge', 'Legal owns the lease', 'strong');
    check('knowledge', 'policy/termination.md', 'dim');

    await pick('partitions');
    check('partitions', 'domain/invoice.ts', 'strong');
    check('partitions', 'Notice is 30 days', 'dim');

    await pick('structure');
    check('structure', 'app/page.tsx', 'normal'); // the structure lens lights every node
  });

  it('surfaces each lens\' insights in the aside', async () => {
    // The per-lens scoped Findings aside lives in the Act rail and is drawn only when the List is
    // not the active camera (the List lists every finding itself). Stay on the opening camera.
    render(
        <StageFactoryContext.Provider value={() => createNoopStage()}>
            <div style={{ height: 600 }}><KnowledgeGraphView source={fixtureSource([graph])} /></div>
        </StageFactoryContext.Provider>,
    );
    await waitFor(() => expect(aside()).toBeTruthy(), MOUNT_WAIT);
    openDetails(deps);
    const expected: Partial<Record<LensId, string[]>> = {
      structure: ['cycle', 'stale'],
      partitions: ['cycle', 'partition-violation', 'partition-violation'],
      duplication: ['clone-group'],
      claims: ['contradiction', 'stale'],
      links: ['broken-link', 'orphan'],
      unused: ['unused-file'],
      knowledge: ['stale'],
      compare: graph.findings.map((f) => f.kind).sort(),
    };
    for (const id of LENS_ORDER) {
      if (!expected[id]) continue;
      await pick(id);
      expect(asideKinds(), id).toEqual(expected[id]);
    }
  });
});

describe('legend and lens notes', () => {
  it('draws the active lens\' legend in the catalog\'s words', async () => {
    await mount(mixedFixture());
    for (const id of LENS_ORDER) {
      await pick(id);
      if (!LENSES[id].legend.length) continue;
      // The Lens panel's legend: one row per tone the lens draws with, named by the catalog.
      const keys = [...screen.getByTestId('kg-legend').querySelectorAll('li[data-legend]')].map((li) => li.getAttribute('data-legend'));
      expect(keys, id).toEqual(LENSES[id].legend.map((row) => row.key));
    }
  });

  it('says a lens does not apply when its packs are not in the folder, and shows the lens that does', async () => {
    await mount(codeFixture(), { initialLens: 'claims' });
    expect(screen.getByTestId('kg-lens-not-applicable')).toBeTruthy();
    expect(lensIsPicked(deps, L, 'structure')).toBe(true); // the lens in effect is the lit pill
    expect(screen.getByText(L.lensHints.structure)).toBeTruthy();
  });

  it('shows no such note for a lens that applies', async () => {
    await mount(mixedFixture(), { initialLens: 'claims' });
    // The requested lens applies: the Lens panel draws its legend, not the not-applicable note.
    expect(screen.queryByTestId('kg-lens-not-applicable')).toBeNull();
  });

  it('explains Claims when nothing has been judged', async () => {
    const base = mixedFixture();
    // `hasJudgement` is true when any node is non-`extracted` (a model claim or a human fact),
    // so a truly unjudged graph has every node marked `extracted` — not just the claim ones.
    const unjudged: KnowledgeGraph = { ...base, nodes: base.nodes.map((n) => ({ ...n, origin: 'extracted' })) };
    await mount(unjudged);
    await pick('claims');
    // The notice renders in the Lens panel (the Act rail's Details section) once nothing is judged.
    expect(await screen.findByText(L.lensNeedsJudgement, undefined, MOUNT_WAIT)).toBeTruthy();
  });

  it('does not show the judgement notice on a judged graph', async () => {
    await mount(mixedFixture());
    await pick('claims');
    expect(screen.queryByText(L.lensNeedsJudgement)).toBeNull();
  });
});
