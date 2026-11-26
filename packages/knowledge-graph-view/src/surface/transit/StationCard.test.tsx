// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { CardModel } from './cardModel';
import { StationCard } from './StationCard';

const t = L.surface.map.card;
const base: CardModel = {
    name: 'API', meta: '2 files · Presentation', issues: ['Layer violation'], issueMore: 2, enter: { can: true, level: 'package' }, unfold: 3, unfolded: false,
    hasApi: true, hasPatterns: true, leaf: false,
    stats: [
        { key: 'issues', label: 'Issues', value: 'high', tone: 'sev3' }, { key: 'complexity', label: 'Complexity', value: '—', tone: null },
        { key: 'coverage', label: 'Coverage', value: '80%', tone: 'sev1' }, { key: 'usage', label: 'Usage', value: '100%', tone: null },
    ],
};

const actions = () => ({ onEnter: vi.fn(), onUnfold: vi.fn(), onCallers: vi.fn(), onApi: vi.fn(), onPatterns: vi.fn() });

function card(over: Partial<CardModel> = {}, extra: Partial<Parameters<typeof StationCard>[0]> = {}) {
    const a = actions();
    render(<StationCard card={{ ...base, ...over }} labels={L} type="source" {...a} {...extra} />);
    return a;
}

const withFacts = (over: Partial<NonNullable<CardModel['facts']>> = {}): Partial<CardModel> => ({ facts: { tests: 'reached', antiPattern: null, ...over } });
const finding = { kind: 'god-module', name: 'God module', findingId: 'f1', restructurable: true };

describe('StationCard (the note-card shell)', () => {
    it('is the docked note card: the name, its kind, the meta, and every action fires', () => {
        const a = card();
        const region = screen.getByRole('region', { name: 'API' });
        expect(region.getAttribute('data-note-card')).toBe('station');
        expect(region.querySelector('[data-note-name]')!.textContent).toBe('API');
        expect(screen.getByText(base.meta)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: t.goInside }));
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(t.unfold, { count: 3 }) }));
        fireEvent.click(screen.getByRole('button', { name: t.whoCalls }));
        fireEvent.click(screen.getByRole('button', { name: t.apiContract }));
        fireEvent.click(screen.getByRole('button', { name: t.patterns }));
        expect(a.onEnter).toHaveBeenCalledTimes(1);
        expect(a.onUnfold).toHaveBeenCalledTimes(1);
        expect(a.onCallers).toHaveBeenCalledTimes(1);
        expect(a.onApi).toHaveBeenCalledTimes(1);
        expect(a.onPatterns).toHaveBeenCalledTimes(1);
    });

    it('offers Simulate, and Restructure INSTEAD of it when the station carries an anti-pattern', () => {
        const onSimulate = vi.fn(), onRestructure = vi.fn();
        card(withFacts(), { onSimulate, onRestructure });
        fireEvent.click(screen.getByRole('button', { name: t.simulate }));
        expect(onSimulate).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: t.restructure })).toBeNull();
        document.body.innerHTML = '';
        card(withFacts({ antiPattern: finding }), { onSimulate, onRestructure });
        expect(screen.queryByRole('button', { name: t.simulate })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: t.restructure }));
        expect(onRestructure).toHaveBeenCalledTimes(1);
    });

    it('hides Simulate and Restructure when their callbacks are absent', () => {
        card(withFacts());
        expect(screen.queryByRole('button', { name: t.simulate })).toBeNull();
        document.body.innerHTML = '';
        card(withFacts({ antiPattern: finding }));
        expect(screen.queryByRole('button', { name: t.restructure })).toBeNull();
        expect(screen.queryByRole('button', { name: t.simulate })).toBeNull();
    });

    it('falls back to Simulate when the anti-pattern has no handler or is not restructurable', () => {
        card(withFacts({ antiPattern: finding }), { onSimulate: vi.fn() });
        expect(screen.getByRole('button', { name: t.simulate })).toBeTruthy();
        expect(screen.queryByRole('button', { name: t.restructure })).toBeNull();
        document.body.innerHTML = '';
        card(withFacts({ antiPattern: { ...finding, kind: 'cycle', restructurable: false } }), { onSimulate: vi.fn(), onRestructure: vi.fn() });
        expect(screen.getByRole('button', { name: t.simulate })).toBeTruthy();
        expect(screen.queryByRole('button', { name: t.restructure })).toBeNull();
        expect(document.querySelector('[data-fact="anti"]')).not.toBeNull();
    });

    it('shows Restructure disabled, with the loading tooltip, while its file is being read', () => {
        card({ ...withFacts({ antiPattern: finding }), restructureReady: false }, { onRestructure: vi.fn() });
        const b = screen.getByRole('button', { name: t.restructure }) as HTMLButtonElement;
        expect(b.disabled).toBe(true);
        expect(b.title).toBe(t.loading);
    });

    it('says nothing about test reach when no coverage was collected', () => {
        card(withFacts({ tests: null }));
        expect(document.querySelector('[data-fact="tests"]')).toBeNull();
    });

    it('states risk in words, test reach, the owner and the anti-pattern name in the facts row', () => {
        card({ ...withFacts({ tests: 'none', antiPattern: finding }), owner: 'Payments' });
        const row = document.querySelector('[data-note-facts]')!;
        expect(row.querySelector('[data-fact="risk"]')?.textContent).toBe(fillTemplate(t.riskWord, { level: 'high' }));
        expect(row.querySelector('[data-fact="tests"]')?.textContent).toBe(t.testNone);
        expect(row.querySelector('[data-fact="owner"]')?.textContent).toBe(fillTemplate(t.ownerIs, { name: 'Payments' }));
        expect(row.querySelector('[data-fact="anti"]')?.textContent).toBe('God module');
        document.body.innerHTML = '';
        card({ ...withFacts({ tests: 'reached' }), stats: base.stats.map((s) => (s.key === 'issues' ? { ...s, tone: null } : s)) });
        expect(document.querySelector('[data-fact="risk"]')?.textContent).toBe(t.noRisk);
        expect(document.querySelector('[data-fact="tests"]')?.textContent).toBe(t.testReached);
        expect(document.querySelector('[data-fact="anti"]')).toBeNull();
    });

    it('draws the answer to the question being asked under its rule', () => {
        card({}, { answer: { icon: null, lead: 'Where is it used?', text: '3 stations' } });
        expect(document.querySelector('[data-note-answer]')?.textContent).toBe('Where is it used? 3 stations');
    });

    it('disables Go inside with the reason (reading, or no symbols) rather than hiding it', () => {
        card({ unfold: 0, hasApi: false, hasPatterns: false, enter: { can: false, reason: 'noSymbols' } });
        expect(screen.queryByRole('button', { name: t.apiContract })).toBeNull();
        expect(screen.queryByRole('button', { name: t.patterns })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Unfold/ })).toBeNull();
        const enter = screen.getByRole('button', { name: t.goInside }) as HTMLButtonElement;
        expect(enter.disabled).toBe(true);
        expect(enter.title).toBe(t.noSymbols);
        document.body.innerHTML = '';
        card({ enter: { can: false, reason: 'noSymbols' } }, { loading: true });
        expect((screen.getByRole('button', { name: t.goInside }) as HTMLButtonElement).title).toBe(t.loading);
    });
});
