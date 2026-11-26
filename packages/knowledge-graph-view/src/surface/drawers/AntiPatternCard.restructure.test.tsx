import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { RestructureContext } from '../useRestructure';
import type { AntiPatternGroup } from './antiPatternGroups';
import { AntiPatternCard } from './AntiPatternCard';

const finding = (kind: string): Finding => ({ id: `${kind}-1`, kind, pack: 'code', nodes: ['src:r::api/big.ts' as never], severity: 'warn', params: {} });
const group = (kind: string): AntiPatternGroup => ({ id: kind, kind, findings: [finding(kind)], files: ['src:r::api/big.ts'], count: 1 });

function card(kind: string, restructure: ((f: Finding) => void) | null) {
    return render(
        <RestructureContext.Provider value={restructure}>
            <AntiPatternCard group={group(kind)} labels={L} index={new Map()} checked={false} onToggle={vi.fn()} onShow={vi.fn()} canShow />
        </RestructureContext.Provider>,
    );
}
const see = () => screen.queryByRole('button', { name: L.surface.compare.seeRestructured });

describe('AntiPatternCard: See it restructured', () => {
    it('shows for a kind that has a proposer, and opens the compare on the card\'s finding', () => {
        const restructure = vi.fn();
        card('god-module', restructure);
        fireEvent.click(see()!);
        expect(restructure).toHaveBeenCalledWith(expect.objectContaining({ id: 'god-module-1', kind: 'god-module' }));
    });

    it('shows for a layer violation, the other restructurable kind', () => {
        card('partition-violation', vi.fn());
        expect(see()).not.toBeNull();
    });

    it('is absent for a kind with no proposer', () => {
        card('cycle', vi.fn());
        expect(see()).toBeNull();
    });

    it('is absent where the host view provides no action', () => {
        card('god-module', null);
        expect(see()).toBeNull();
    });
});
