// @vitest-environment jsdom
/** A finding's params, notes and aggregation read localized; prefixed reason codes name their rule. */
import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';
import { DeltaFindingItem } from './DeltaFindingItem';
import { blockingLabel, noteLabel, reasonLabel } from './deltaText';
import { DEFAULT_RUN_DELTA_LABELS, runDeltaLabels } from './labels';
import { finding } from './fixtures';

const L = DEFAULT_RUN_DELTA_LABELS;
const FR = runDeltaLabels((key) => ({
    'params.via': 'Détecté par',
    'params.route': 'Route',
    'paramValues.via.unguardedSibling': 'Non protégée parmi des routes sœurs protégées',
    'paramValues.change.edited': 'Modifié',
    'rules.deltaConfigChanged': 'Fichier de politique des écarts modifié',
    'aggregated': 'regroupés ({count})',
} as Record<string, string>)[key]);

describe('DeltaFindingItem params and notes', () => {
    it('labels param names and coded values, and keeps data values as they are', () => {
        const f = finding({ ruleId: 'guard-removed', dimension: 'security', params: { route: 'POST /api/x', via: 'unguarded-sibling' } });
        const { container } = render(<ul><DeltaFindingItem finding={f} labels={FR} /></ul>);
        const dl = container.querySelector('dl') as HTMLElement;
        expect(within(dl).getByText('Détecté par')).toBeTruthy();
        expect(within(dl).getByText('Non protégée parmi des routes sœurs protégées')).toBeTruthy();
        expect(within(dl).getByText('POST /api/x')).toBeTruthy();
        expect(dl.textContent).not.toContain('unguarded-sibling');
    });

    it('shows aggregated hits as an ≈ chip with their count, not as raw params', () => {
        const f = finding({ ruleId: 'secret-added', dimension: 'security', confidence: 'heuristic', params: { file: 'a.ts', key: 'aws', count: 12, aggregated: 1 } });
        const { container } = render(<ul><DeltaFindingItem finding={f} labels={FR} /></ul>);
        expect(container.querySelector('[data-aggregated]')!.textContent).toBe('≈ regroupés (12)');
        const dl = container.querySelector('dl') as HTMLElement;
        expect(dl.textContent).not.toMatch(/aggregated|12/);
    });

    it('reads a delta-config change note localized and a data note as is', () => {
        const f = finding({ ruleId: 'delta-config-changed', dimension: 'security', params: { file: '.builderforce/delta.json', change: 'edited' } });
        expect(noteLabel(FR, f, 'edited')).toBe('Modifié');
        expect(noteLabel(FR, { ruleId: 'cycle', params: {} }, 'cycle')).toBe(L.rules.cycle);
        expect(noteLabel(FR, f, 'GET /api/x')).toBe('GET /api/x');
    });

    it('passes the rule id of prefixed reasons and blocking codes through the rule label', () => {
        expect(reasonLabel(L, 'analyzer-failed:guard-removed')).toBe(`${L.rules.guardRemoved} failed`);
        expect(reasonLabel(L, 'not-comparable:delta-config-changed')).toBe(`${L.rules.deltaConfigChanged} could not be certified`);
        expect(reasonLabel(L, 'unsafe-regex:io.nested-quantifier')).toBe('io: unsafe pattern dropped (nested quantifier)');
        expect(blockingLabel(L, 'guard-removed')).toBe(L.rules.guardRemoved);
        expect(blockingLabel(L, 'head-switched')).toBe(L.reasons.headSwitched);
    });
});
