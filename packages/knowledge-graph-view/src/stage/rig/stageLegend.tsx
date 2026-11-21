/**
 * The shape key docked on the stage corner. A camera's host provides the types on screen and the
 * localized legend words; `Stage` reads them and `StageCorner` draws `ShapeLegend` above the nav.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import type { MarkType } from '../../shapes';

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
