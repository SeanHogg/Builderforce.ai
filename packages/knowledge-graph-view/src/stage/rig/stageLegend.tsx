/**
 * The shape key docked on the stage corner. A camera's host provides the types on screen and the
 * localized legend words; `Stage` reads them and `StageCorner` draws `ShapeLegend` above the nav.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import { MARK_TYPE_ORDER, typesPresent, type MarkType } from '../../shapes';

/** On-screen mark types: `MarkSet.type` indexes `MARK_TYPE_ORDER`; the legend lists each present type once, in that order. */
export function legendTypesOf(type: Uint8Array | undefined): MarkType[] {
    if (!type || type.length === 0) return [];
    const present: MarkType[] = [];
    for (let i = 0; i < type.length; i++) {
        const name = MARK_TYPE_ORDER[type[i]!];
        if (name) present.push(name);
    }
    return typesPresent(present);
}

export interface StageLegendValue {
    types: readonly MarkType[];
    labels: Pick<KnowledgeGraphLabels, 'legend'>;
}

const StageLegendContext = createContext<StageLegendValue | null>(null);

export function StageLegendProvider({ types, labels, children }: StageLegendValue & { children: ReactNode }) {
    return <StageLegendContext.Provider value={{ types, labels }}>{children}</StageLegendContext.Provider>;
}

export function useStageLegend(): StageLegendValue | null {
    return useContext(StageLegendContext);
}
