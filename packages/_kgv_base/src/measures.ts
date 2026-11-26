/**
 * The three measures a god module is judged by, as DATA: where each one is read (the finding's
 * params first, else the file's badges, which older graphs carry) and where its limit is. A measure
 * the graph does not carry stays absent: it is shown as "not measured", never as a zero. Pure.
 */

import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';

export type MeasureId = 'lines' | 'exports' | 'complexity';

interface MeasureDef {
    id: MeasureId;
    /** Key of `labels.surface.patterns.block` naming it. */
    labelKey: 'measureLines' | 'measureExports' | 'measureComplexity';
    param: string;
    limitParam: string;
    badge: string;
}

export const MEASURES: readonly MeasureDef[] = [
    { id: 'lines', labelKey: 'measureLines', param: 'lines', limitParam: 'linesLimit', badge: 'lines' },
    { id: 'exports', labelKey: 'measureExports', param: 'exports', limitParam: 'exportsLimit', badge: 'exports' },
    { id: 'complexity', labelKey: 'measureComplexity', param: 'complexity', limitParam: 'complexityLimit', badge: 'maxComplexity' },
];

export interface Measure {
    id: MeasureId;
    labelKey: MeasureDef['labelKey'];
    value?: number;
    limit?: number;
}

const num = (v: unknown): number | undefined => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

export function measuresOf(node: Pick<KNode, 'badges'> | undefined, finding?: Pick<Finding, 'params'>): Measure[] {
    return MEASURES.map((m) => {
        const value = num(finding?.params[m.param]) ?? num(node?.badges?.[m.badge]);
        const limit = num(finding?.params[m.limitParam]);
        return { id: m.id, labelKey: m.labelKey, ...(value !== undefined ? { value } : {}), ...(limit !== undefined ? { limit } : {}) };
    });
}

/** Where the limit mark sits on a bar, as a fraction of its length: a bar past the mark is over. */
export const LIMIT_MARK = 0.7;

export function measureBar(value: number, limit: number): { frac: number; over: boolean } {
    const scale = limit > 0 ? limit / LIMIT_MARK : Math.max(value, 1);
    return { frac: Math.min(1, Math.max(0, value / scale)), over: value > limit };
}
