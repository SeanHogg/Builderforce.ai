// @vitest-environment jsdom
/** The question pills, the More questions menu (every former lens), the family chip and the lens-only pick. */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { lensOnlyOf, QuestionBar } from './QuestionBar';
import { MORE_QUESTIONS, questionForLens } from './questions';
import { graph, lenses, model } from './testFixtures';
import { useSurface } from './useSurface';

const bar = (over: Partial<Parameters<typeof QuestionBar>[0]> = {}) => {
    const p = { labels: L, stations: model.stations, question: 'where' as const, onQuestion: vi.fn(), lenses, lens: 'structure' as const, onLens: vi.fn(), ...over };
    render(<QuestionBar {...p} />);
    return p;
};
const pill = (q: string) => document.querySelector(`button[data-question="${q}"]`) as HTMLElement;

describe('QuestionBar', () => {
    it('keeps every former lens reachable: the More menu lists each with a "was the {lens} lens" sub-line, and picking one does what its chip did', () => {
        const p = bar();
        fireEvent.click(screen.getByRole('button', { name: L.surface.moreQuestions }));
        const menu = within(screen.getByRole('menu', { name: L.surface.moreQuestions }));
        for (const lens of lenses) {
            const q = questionForLens(lens.id);
            if (q !== undefined && !MORE_QUESTIONS.some((m) => m.id === q)) {
                expect(pill(q), lens.id).toBeTruthy(); // a primary question's twin opens with its pill
                continue;
            }
            expect(menu.getByText(fillTemplate(L.surface.overlay.lensSub, { lens: L.lenses[lens.id] })), lens.id).toBeTruthy();
        }
        fireEvent.click(menu.getByRole('menuitem', { name: new RegExp(`^${L.surface.questions.copied}`) }));
        expect(p.onQuestion).toHaveBeenCalledWith('copied');
        fireEvent.click(screen.getByRole('button', { name: L.surface.moreQuestions }));
        if (lenses.some((l) => l.id === 'compare')) {
            fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${L.lenses.compare}`) }));
            expect(p.onLens).toHaveBeenCalledWith('compare');
        }
    });

    it('marks a question whose data was never collected, and says so in its tooltip', () => {
        bar({ stations: model.stations.map((s) => ({ ...s, cov: undefined })) });
        expect(pill('untested').title).toContain(L.surface.answerNotSetUp);
    });

    it('shows "{family} only ✕" while a family filter is on, and ✕ clears it', () => {
        const onClearFamily = vi.fn();
        bar({ family: 'Behavioural', onClearFamily });
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(L.surface.overlay.clearFamily, { family: 'Behavioural' }) }));
        expect(onClearFamily).toHaveBeenCalled();
        expect(screen.getByText(new RegExp(fillTemplate(L.surface.overlay.familyOnly, { family: 'Behavioural' })))).toBeTruthy();
    });

    it('shows no family chip without a filter', () => {
        bar();
        expect(document.querySelector('[data-family-chip]')).toBeNull();
    });

    describe('a lens-only pick (Compare)', () => {
        const compare = lenses.find((l) => l.id === 'compare');

        it('is recognised only when the lens has no question and is on offer', () => {
            expect(lensOnlyOf(lenses, 'structure')).toBeNull();
            expect(lensOnlyOf(undefined, 'compare')).toBeNull();
            if (compare) expect(lensOnlyOf(lenses, 'compare')).toBe('compare');
        });

        it('lights the More trigger with that lens\'s name, lights no pill, and selects only its item', () => {
            if (!compare) return; // the fixture's lenses decide whether Compare is on offer
            bar({ lens: 'compare', question: 'where' });
            expect(pill('where').getAttribute('aria-pressed')).toBe('false');
            const trigger = screen.getByRole('button', { name: L.lenses.compare });
            expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
            fireEvent.click(trigger);
            const selected = [...document.querySelectorAll('[role="menuitem"][data-selected="true"]')].map((el) => el.getAttribute('data-item'));
            expect(selected).toEqual(['lens:compare']);
        });

        it('a question pick lights its pill again', () => {
            bar({ lens: 'structure', question: 'wrong' });
            expect(pill('wrong').getAttribute('aria-pressed')).toBe('true');
        });
    });
});

describe('the family filter on the surface', () => {
    it('narrows the patterns question to a family, and any other question drops it', () => {
        const names = (surface: ReturnType<typeof useSurface>) => [...(surface.lit ?? [])].map((id) => surface.stations.byId.get(id)!.name);
        let surface!: ReturnType<typeof useSurface>;
        function Probe() { surface = useSurface(graph, null); return null; }
        render(<Probe />);
        act(() => surface.setFamily('repository'));
        expect(surface.question).toBe('patterns');
        expect(surface.family).toBe('repository');
        expect(names(surface)).toEqual(['API']);
        act(() => surface.setFamily('no-such-family'));
        expect(names(surface)).toEqual([]);
        act(() => surface.setQuestion('wrong'));
        expect(surface.family).toBeNull();
    });
});
