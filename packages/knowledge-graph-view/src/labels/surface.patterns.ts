/** The patterns words of the surface: the interface and its English defaults (a host overrides them per key). */

export interface PatternsLabels {
    /** `{family}`, `{layer}`, `{count}`. */
    patterns: Record<
        'notSetUpTitle' | 'notSetUpBody' | 'matrixTitle' | 'antiRow' | 'cellAria' | 'listTitle' | 'listHint' | 'antiTitle' | 'antiNone'
        | 'resolve' | 'showInTower',
        string
    >;
}

export const PATTERNS_DEFAULTS: PatternsLabels = {
    patterns: {
        notSetUpTitle: 'Patterns are not set up',
        notSetUpBody: 'No pattern was detected in this folder, so the matrix is empty.',
        matrixTitle: 'Pattern families by layer',
        antiRow: 'Anti-pattern',
        cellAria: '{family}, {layer}: {count}',
        listTitle: 'Patterns found',
        listHint: 'Heuristic: read from names, exports, imports and size.',
        antiTitle: 'Anti-patterns',
        antiNone: 'No anti-patterns were found.',
        resolve: 'Resolve',
        showInTower: 'Show in Tower',
    },
};
