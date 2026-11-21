/**
 * The stage's docked shape legend (PRD 43 B1a rule 2): the host that knows which mark types are on screen supplies them
 * through `StageLegendProvider`; `Stage` reads `useStageLegend()` and docks `ShapeLegend` in its corner. No provider, or
 * no types on screen, means no legend.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import type { MarkType } from '../../shapes';

export interface StageLegendValue {
    types: readonly MarkType[];
    labels: Pick<KnowledgeGraphLabels, 'legend'>;
}

const StageLegendContext = createContext<StageLegendValue | null>(null);

export interface StageLegendProviderProps {
    types: readonly MarkType[];
    labels: Pick<KnowledgeGraphLabels, 'legend'>;
    children: ReactNode;
}

export function StageLegendProvider({ types, labels, children }: StageLegendProviderProps) {
    const value = useMemo(() => ({ types, labels }), [types, labels]);
    return <StageLegendContext.Provider value={value}>{children}</StageLegendContext.Provider>;
}

/** The legend the host supplied, or null. */
export function useStageLegend(): StageLegendValue | null {
    return useContext(StageLegendContext);
}
