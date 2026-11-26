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
        { key: 'issues', label: 'Issues', value: '3', tone: 'sev3' }, { key: 'complexity', label: 'Complexity', value: '—', tone: null },
        { key: 'coverage', label: 'Coverage', value: '80%', tone: 'sev1' }, { key: 'usage', label: 'Usage', value: '100%', tone: null },
    ],
};

function card(over: Partial<CardModel> = {}, compact = false) {
    const actions = { onClose: vi.fn(), onEnter: vi.fn(), onUnfold: vi.fn(), onCallers: vi.fn(), onApi: vi.fn(), onPatterns: vi.fn() };
    render(<StationCard card={{ ...base, ...over }} labels={L} compact={compact} at={{ left: 10, top: 20 }} {...actions} />);
    return actions;
}

describe('StationCard', () => {
    it('shows four stats, the issues and every action, and each action fires', () => {
        const a = card();
        expect(screen.getByRole('dialog', { name: 'API' })).toBeTruthy();
        expect(document.querySelectorAll('[data-stat]')).toHaveLength(4);
        expect(screen.getByText('Layer violation')).toBeTruthy();
        expect(screen.getByText(fillTemplate(t.issueMore, { count: 2 }))).toBeTruthy();
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

    const withFacts = (over: Partial<NonNullable<CardModel['facts']>> = {}): Partial<CardModel> => ({ facts: { tests: 'reached', antiPattern: null, ...over } });
    const finding = { kind: 'god-module', name: 'God module', findingId: 'f1' };

    it('offers Simulate, and Restructure INSTEAD of it when the station carries an anti-pattern', () => {
        const onSimulate = vi.fn(), onRestructure = vi.fn();
        render(<StationCard card={{ ...base, ...withFacts() }} labels={L} compact={false} at={{ left: 0, top: 0 }} onClose={vi.fn()} onEnter={vi.fn()} onUnfold={vi.fn()} onCallers={vi.fn()} onApi={vi.fn()} onPatterns={vi.fn()} onSimulate={onSimulate} onRestructure={onRestructure} />);
        fireEvent.click(screen.getByRole('button', { name: t.simulate }));
        expect(onSimulate).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: t.restructure })).toBeNull();
        document.body.innerHTML = '';
        render(<StationCard card={{ ...base, ...withFacts({ antiPattern: finding }) }} labels={L} compact={false} at={{ left: 0, top: 0 }} onClose={vi.fn()} onEnter={vi.fn()} onUnfold={vi.fn()} onCallers={vi.fn()} onApi={vi.fn()} onPatterns={vi.fn()} onSimulate={onSimulate} onRestructure={onRestructure} />);
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

    it('states risk, test reach and the anti-pattern name in the facts row', () => {
        card(withFacts({ tests: 'none', antiPattern: finding }));
        const row = document.querySelector('[data-card-facts]')!;
        expect(row.querySelector('[data-fact="risk"]')?.textContent).toBe(`${t.risk}: 3`);
        expect(row.querySelector('[data-fact="tests"]')?.textContent).toBe(t.testNone);
        expect(row.querySelector('[data-fact="anti"]')?.textContent).toBe('God module');
        document.body.innerHTML = '';
        card(withFacts({ tests: 'reached' }));
        expect(document.querySelector('[data-fact="tests"]')?.textContent).toBe(t.testReached);
        expect(document.querySelector('[data-fact="anti"]')).toBeNull();
    });

    it('moves focus into the card, and closes on Escape and on a press outside, not on a press inside', () => {
        const a = card();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: t.goInside }));
        fireEvent.pointerDown(screen.getByText('Layer violation'));
        expect(a.onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(a.onClose).toHaveBeenCalledTimes(1);
        // However many ways ask, one card closes once.
        fireEvent.pointerDown(document.body);
        expect(a.onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on a press outside, and stops Escape from reaching anything above it', () => {
        const a = card();
        fireEvent.pointerDown(document.body);
        expect(a.onClose).toHaveBeenCalledTimes(1);
        const later = vi.fn();
        document.addEventListener('keydown', later);
        fireEvent.keyDown(screen.getByRole('button', { name: t.goInside }), { key: 'Escape' });
        document.removeEventListener('keydown', later);
        expect(later).not.toHaveBeenCalled();
    });

    it('moves focus in without scrolling the map', () => {
        const focus = vi.spyOn(HTMLElement.prototype, 'focus');
        card();
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        focus.mockRestore();
    });

    it('says it is reading symbols, not that there are none, while the definitions load', () => {
        card({ enter: { can: false, reason: 'noSymbols' } });
        expect(screen.getByText(t.noSymbols)).toBeTruthy();
        document.body.innerHTML = '';
        const actions = { onClose: vi.fn(), onEnter: vi.fn(), onUnfold: vi.fn(), onCallers: vi.fn(), onApi: vi.fn(), onPatterns: vi.fn() };
        render(<StationCard card={{ ...base, enter: { can: false, reason: 'noSymbols' } }} labels={L} compact={false} at={{ left: 0, top: 0 }} loading {...actions} />);
        expect(screen.getByText(t.loading)).toBeTruthy();
        expect(screen.queryByText(t.noSymbols)).toBeNull();
    });

    it('hides actions that do not apply, and disables Go inside with the reason rather than hiding it', () => {
        card({ unfold: 0, hasApi: false, hasPatterns: false, enter: { can: false, reason: 'noSymbols' } });
        expect(screen.queryByRole('button', { name: t.apiContract })).toBeNull();
        expect(screen.queryByRole('button', { name: t.patterns })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Unfold/ })).toBeNull();
        expect((screen.getByRole('button', { name: t.goInside }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(t.noSymbols)).toBeTruthy();
        expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'API' }));
    });

    it('becomes the bottom sheet in a compact container', () => {
        const a = card({}, true);
        expect(document.querySelector('[data-station-card]')).toBeNull();
        expect(screen.getByRole('dialog', { name: 'API' }).tagName).toBe('ASIDE');
        fireEvent.click(screen.getByRole('button', { name: t.close }));
        expect(a.onClose).toHaveBeenCalled();
    });

    it('in a compact container closes once on Escape (the sheet and the document both hear it), and on a press outside, not inside', () => {
        const a = card({}, true);
        fireEvent.pointerDown(screen.getByText('Layer violation'));
        expect(a.onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByRole('dialog', { name: 'API' }), { key: 'Escape' });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(a.onClose).toHaveBeenCalledTimes(1);
    });

    it('in a compact container closes on a press outside the sheet', () => {
        const a = card({}, true);
        fireEvent.pointerDown(document.body);
        expect(a.onClose).toHaveBeenCalledTimes(1);
    });
});
