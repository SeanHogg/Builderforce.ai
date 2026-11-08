// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { AntiPatternBlock } from './AntiPatternBlock';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { measureBar } from './measures';
import { surfaceFixture } from './testing';

const base = surfaceFixture();
const FILE = 'src:sys::api/routes.ts' as Finding['nodes'][number];
const god = (params: Finding['params']): Finding => ({ id: 'god1', kind: 'god-module', pack: 'code', nodes: [FILE], severity: 'warn', params });
const withFindings = (findings: Finding[], badges?: Record<string, string | number>): KnowledgeGraph => ({
    ...base, findings,
    nodes: base.nodes.map((n) => (n.ref === FILE ? { ...n, badges: { ...n.badges, ...badges } } : n)),
});

describe('AntiPatternBlock', () => {
    it('draws a god module: the tag, the three measures against their limits, over in violation and under in agrees', () => {
        const finding = god({ lines: 2500, exports: 10, complexity: 30, linesLimit: 1000, exportsLimit: 40, complexityLimit: 60 });
        render(<AntiPatternBlock graph={withFindings([finding])} nodeRef={FILE} labels={L} onResolve={vi.fn()} onShowInTower={vi.fn()} />);
        expect(screen.getByText('Anti-pattern · God module')).toBeTruthy();
        expect(document.querySelector('[data-measure="lines"]')!.getAttribute('data-over')).toBe('true');
        expect(document.querySelector('[data-measure="exports"]')!.getAttribute('data-over')).toBe('false');
        expect(document.querySelector('[data-measure="complexity"]')!.getAttribute('data-over')).toBe('false');
        expect(screen.getByText('2,500')).toBeTruthy();
        expect(document.querySelector('[data-provenance="heuristic"]')).not.toBeNull();
    });

    it('Fix opens Resolve on the finding; Show in Tower lights it', () => {
        const finding = god({ lines: 2500, linesLimit: 1000 });
        const onResolve = vi.fn(), onShowInTower = vi.fn();
        render(<AntiPatternBlock graph={withFindings([finding])} nodeRef={FILE} labels={L} onResolve={onResolve} onShowInTower={onShowInTower} />);
        fireEvent.click(screen.getByRole('button', { name: 'Fix God module' }));
        expect(onResolve).toHaveBeenCalledWith(finding);
        fireEvent.click(screen.getByRole('button', { name: L.surface.patterns.block.showInTower }));
        const [highlight, refs] = onShowInTower.mock.calls[0]!;
        expect(highlight.kinds).toEqual(['god-module']);
        expect(highlight.roles.get(FILE)).toBe('offender');
        expect(refs).toEqual(expect.arrayContaining([FILE]));
    });

    it('Show in Tower on a god module that has only the badge still lights the file, so the legend can say what good looks like', () => {
        const onShowInTower = vi.fn();
        render(<AntiPatternBlock graph={withFindings([], { patterns: 'god-module' })} nodeRef={FILE} labels={L} onShowInTower={onShowInTower} />);
        fireEvent.click(screen.getByRole('button', { name: L.surface.patterns.block.showInTower }));
        const [highlight] = onShowInTower.mock.calls[0]!;
        expect(highlight.kinds).toEqual(['god-module']);
        expect([...highlight.roles]).toEqual([[FILE, 'offender']]);
    });

    it('a file a violation reaches INTO is its partner: "Reached by", the offender listed, and the Tower marks the roles', () => {
        const cron = 'src:sys::cron/job.ts' as Finding['nodes'][number], useCase = 'src:sys::api/useCase.ts' as Finding['nodes'][number];
        const pv: Finding = { id: 'pv', kind: 'partition-violation', pack: 'code', nodes: [cron, useCase], severity: 'error', params: { verdict: 'skips', from: 'entry', to: 'application', kind: 'references' } };
        const onShowInTower = vi.fn();
        render(<AntiPatternBlock graph={withFindings([pv])} nodeRef={useCase} labels={L} onResolve={vi.fn()} onShowInTower={onShowInTower} />);
        expect(document.querySelector('[data-role="partner"]')).not.toBeNull();
        expect(screen.getByText(L.surface.patterns.block.reachedBy)).toBeTruthy();
        expect(screen.queryByText(L.surface.patterns.block.reachesInto)).toBeNull();
        expect(screen.getByText('cron/job.ts')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: L.surface.patterns.block.showInTower }));
        const [highlight] = onShowInTower.mock.calls[0]!;
        expect(highlight.roles.get(useCase)).toBe('partner');
        expect(highlight.roles.get(cron)).toBe('offender');
    });

    it('one section per layer pair when a file has violations to several', () => {
        const cron = 'src:sys::cron/job.ts' as Finding['nodes'][number];
        const mk = (id: string, to: string, target: string): Finding => ({ id, kind: 'partition-violation', pack: 'code', nodes: [cron, target as Finding['nodes'][number]], severity: 'error', params: { verdict: 'skips', from: 'entry', to, kind: 'references' } });
        render(<AntiPatternBlock graph={withFindings([mk('a', 'application', 'src:sys::api/useCase.ts'), mk('b', 'infrastructure', 'src:sys::db/repo.ts')])} nodeRef={cron} labels={L} />);
        expect(document.querySelectorAll('[data-role="offender"]')).toHaveLength(2);
    });

    it('with only the badge (no finding): shows the measures it has, says "not measured" for the rest, and offers no Fix', () => {
        render(<AntiPatternBlock graph={withFindings([], { patterns: 'god-module, repository', exports: 55 })} nodeRef={FILE} labels={L} onResolve={vi.fn()} />);
        expect(screen.getByText('Anti-pattern · God module')).toBeTruthy();
        expect(screen.getByText('55')).toBeTruthy();
        expect(screen.getAllByText(L.surface.patterns.block.notMeasured).length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: /^Fix/ })).toBeNull();
        expect(screen.getByText(L.surface.patterns.block.reReview)).toBeTruthy();
    });

    it('draws nothing for a file with no anti-pattern', () => {
        const { container } = render(<AntiPatternBlock graph={withFindings([])} nodeRef={FILE} labels={L} />);
        expect(container.firstChild).toBeNull();
    });

    it('shows a layer violation on the file: the count, the arrow and the files it reaches into', () => {
        const pv: Finding = {
            id: 'pv', kind: 'partition-violation', pack: 'code', nodes: ['src:sys::cron/job.ts' as Finding['nodes'][number], 'src:sys::api/useCase.ts' as Finding['nodes'][number]],
            severity: 'error', params: { verdict: 'skips', from: 'entry', to: 'application', kind: 'references' },
        };
        render(<AntiPatternBlock graph={withFindings([pv])} nodeRef={'src:sys::cron/job.ts'} labels={L} onResolve={vi.fn()} />);
        expect(screen.getByText('Anti-pattern · Layer violation')).toBeTruthy();
        expect(screen.getByText('1 link')).toBeTruthy();
        expect(screen.getByText('api/useCase.ts')).toBeTruthy();
        expect(document.querySelector('[data-diagram="layerArrow"]')).not.toBeNull();
    });
});

describe('measureBar', () => {
    it('puts the limit at 70% of the bar and calls a value past it over', () => {
        expect(measureBar(500, 1000).frac).toBeCloseTo(0.35, 5);
        expect(measureBar(500, 1000).over).toBe(false);
        expect(measureBar(1000, 1000).over).toBe(false);
        expect(measureBar(5000, 1000)).toEqual({ frac: 1, over: true });
    });
});
