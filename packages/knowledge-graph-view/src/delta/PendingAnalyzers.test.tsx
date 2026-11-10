// @vitest-environment jsdom
/** The L3 analyzers a phase-1 delta still waits on (PRD 41 §6): "<tool> — measuring…" on the card and in the panel, localized; gone when final. */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { RunDelta } from '@builderforce/run-delta/contract';
import { RunDeltaCard } from './RunDeltaCard';
import { RunDeltaPanel } from './RunDeltaPanel';
import { DEFAULT_RUN_DELTA_LABELS, runDeltaLabels } from './labels';
import { pendingTools } from './PendingAnalyzers';
import { worseDelta } from './fixtures';

const L = DEFAULT_RUN_DELTA_LABELS;

/** The fixture delta with gitleaks pending in security and jscpd pending in maintainability (twice: once per dimension it covers). */
function pendingDelta(): RunDelta {
    const d = worseDelta();
    return {
        ...d,
        dimensions: d.dimensions.map((dim, i) => ({
            ...dim,
            measuredBy: [...dim.measuredBy, { tool: i % 2 === 0 ? 'gitleaks' : 'jscpd', version: '', status: 'pending' as const }, { tool: 'jscpd', version: '', status: 'pending' as const }],
        })),
    };
}

describe('pending analyzers', () => {
    it('lists each pending tool once, sorted', () => {
        expect(pendingTools(pendingDelta())).toEqual(['gitleaks', 'jscpd']);
        expect(pendingTools(worseDelta())).toEqual([]);
    });

    it('the card shows "<tool> — measuring…" per pending tool, localized, and nothing once final', () => {
        const de = runDeltaLabels((key) => ({ measuringTool: '{tool} — wird gemessen…', measuringHeading: 'Wird noch gemessen' } as Record<string, string>)[key]);
        const { container } = render(<RunDeltaCard delta={pendingDelta()} labels={de} onOpenDetails={() => {}} />);
        const rows = [...container.querySelectorAll('[data-pending]')].map((n) => n.textContent);
        expect(rows).toEqual(['gitleaks — wird gemessen…', 'jscpd — wird gemessen…']);
        const final = render(<RunDeltaCard delta={worseDelta()} labels={L} onOpenDetails={() => {}} />);
        expect(final.container.querySelectorAll('[data-pending]')).toHaveLength(0);
    });

    it('the panel shows the "Still measuring" section with the same rows', () => {
        const { container } = render(<RunDeltaPanel open delta={pendingDelta()} labels={L} onClose={() => {}} compact={false} />);
        const section = container.ownerDocument.querySelector('[data-measuring]')!;
        expect(section.textContent).toContain(L.measuringHeading);
        expect([...section.querySelectorAll('[data-pending]')].map((n) => n.textContent)).toEqual(['gitleaks — measuring…', 'jscpd — measuring…']);
    });
});
