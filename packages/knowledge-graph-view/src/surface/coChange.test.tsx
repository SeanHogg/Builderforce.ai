// @vitest-environment jsdom
/**
 * PRD 38 P4 on the surfaces: the co-change partners read with memory's decoder, "What changed?" (the Act rail card), the fix
 * flow's tests check and "This path is done when…" — each with its rate worded by `rateFormat`, and "Not set up" with no history.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { nodeIndex } from '../graphModel';
import { initialFlow } from './fix/fixFlow';
import { FixChecksList } from './fix/FixChecksList';
import { DoneWhen } from './ActFooter';
import { ActPanel } from './ActPanel';
import { partnersOf, partnerTests } from './coChange';
import { pathOfLine } from './path';
import { rateFormat } from './rateFormat';
import { graph as plain, lines, model } from './testFixtures';

const refOf = (g: KnowledgeGraph, tail: string) => g.nodes.find((n) => n.ref.endsWith(tail))!.ref;
const routes = refOf(plain, 'api/routes.ts'), useCase = refOf(plain, 'api/useCase.ts'), repo = refOf(plain, 'db/repo.ts');
const repoTest = repo.replace('db/repo.ts', 'db/repo.test.ts') as KNode['ref'];

/** The fixture with history: routes.ts usually changes with repo.ts (3 of 4) and useCase.ts (2 of 4); a test references repo.ts. */
const withHistory: KnowledgeGraph = {
    ...plain,
    nodes: [
        ...plain.nodes.map((n) => (n.ref === routes ? { ...n, badges: { ...n.badges, coChange: `v1\n3\t4\t0.32\t0.97\t${repo}\n2\t4\t0.12\t0.88\t${useCase}` } } : n)),
        { ...plain.nodes.find((n) => n.ref === repo)!, ref: repoTest, label: 'repo.test.ts', badges: {} },
    ],
    edges: [...plain.edges, { from: repoTest, to: repo, kind: 'references' } as KnowledgeGraph['edges'][number]],
};
const repoRate = rateFormat(L, { k: 3, n: 4, low: 0.32, high: 0.97 });

describe('partnersOf', () => {
    it('is null with no co-change badge anywhere: the surfaces say Not set up, never guess', () => {
        expect(partnersOf(plain, [routes])).toBeNull();
    });

    it("lists a file's partners in memory's order, minus the files already in the set, each once", () => {
        expect(partnersOf(withHistory, [routes])!.map((p) => p.ref)).toEqual([repo, useCase]);
        expect(partnersOf(withHistory, [routes, repo])!.map((p) => p.ref)).toEqual([useCase]);
        expect(partnersOf(withHistory, [routes], 1)).toHaveLength(1);
    });

    it("finds the partners' tests: test files that reference a partner", () => {
        expect(partnerTests(withHistory, partnersOf(withHistory, [routes])!)).toEqual(['db/repo.test.ts']);
    });
});

describe('"What changed?" partners card', () => {
    const act = (graph: KnowledgeGraph, changedPartners: ReturnType<typeof partnersOf> | undefined) => render(
        <ActPanel graph={graph} findings={[]} labels={L} station={null} stations={model.stations} scopeName={null} compact={false} onClearScope={vi.fn()} onShow={vi.fn()} changedPartners={changedPartners} />,
    );

    it('shows the untouched partners of the changed files, each with its confidence', () => {
        act(withHistory, partnersOf(withHistory, [routes]));
        const items = [...document.querySelectorAll('[data-partner]')].map((li) => li.textContent);
        expect(items[0]).toContain(repoRate);
        expect(items[0]!.startsWith('≈')).toBe(false);
        expect(items[0]).toContain('≈ ');
        expect(items).toHaveLength(2);
    });

    it('says Not set up with no history', () => {
        act(plain, partnersOf(plain, [routes]));
        expect(document.querySelector('[data-partners="not-set-up"]')!.textContent).toBe(L.surface.notSetUp);
    });

    it('is absent while the question is not asked', () => {
        act(withHistory, undefined);
        expect(document.querySelector('[data-testid="kg-changed-partners"]')).toBeNull();
    });
});

describe('fix flow Run checks: the partners\' tests', () => {
    const checks = initialFlow('f').checks;
    it('names the partners\' test files under the tests check', () => {
        render(<FixChecksList checks={checks} details={{}} labels={L} partnerTests={['db/repo.test.ts']} />);
        const line = document.querySelector('[data-check="tests"] [data-partner-tests]')!;
        expect(line.textContent).toContain('db/repo.test.ts');
    });

    it('says Not set up with no history', () => {
        render(<FixChecksList checks={checks} details={{}} labels={L} partnerTests={null} />);
        expect(document.querySelector('[data-partner-tests="not-set-up"]')!.textContent).toContain(L.surface.notSetUp);
    });
});

describe('"This path is done when…" partners', () => {
    const index = nodeIndex(withHistory);
    it('lists the partners of the path with their rate', () => {
        render(<DoneWhen findings={[]} labels={L} index={index} partners={partnersOf(withHistory, [routes])} />);
        expect(document.querySelector('[data-testid="kg-done-partners"]')!.textContent).toContain(repoRate);
    });

    it('says Not set up with no history', () => {
        render(<DoneWhen findings={[]} labels={L} index={index} partners={null} />);
        expect(document.querySelector('[data-testid="kg-done-partners"] [data-partners="not-set-up"]')).toBeTruthy();
    });

    it('the Act rail feeds the drawn path\'s partners to the footer', () => {
        const path = pathOfLine(lines.lines[0]!, model.byId);
        render(<ActPanel graph={plain} findings={[]} labels={L} station={null} stations={model.stations} scopeName={null} compact={false} onClearScope={vi.fn()} onShow={vi.fn()} path={path} />);
        expect(document.querySelector('[data-testid="kg-done-partners"] [data-partners="not-set-up"]')).toBeTruthy();
    });
});
