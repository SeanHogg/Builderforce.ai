/** The patterns words of the surface: the interface and its English defaults (a host overrides them per key). */

/** The keys of the reason / good / after sentences, one trio per rule row (`surface/drawers/antiPatternRules.ts`). */
export type PatternsRuleKey =
    | 'partitionViolationReason' | 'partitionViolationGood' | 'partitionViolationAfter'
    | 'godModuleReason' | 'godModuleGood' | 'godModuleAfter'
    | 'genericReason' | 'genericGood' | 'genericAfter';

export interface PatternsLabels {
    /** `{family}`, `{layer}`, `{count}`. */
    patterns: Record<
        'notSetUpTitle' | 'notSetUpBody' | 'matrixTitle' | 'antiRow' | 'cellAria' | 'listTitle' | 'listHint' | 'antiTitle' | 'antiNone'
        | 'resolve' | 'showInTower'
        // The grouped list (`{anti}`, `{kinds}`, `{findings}`, `{groups}`, `{from}`, `{to}`, `{route}`, `{verdict}`, `{links}`, `{files}`, `{names}`, `{more}`, `{count}`, `{title}`, `{layer}`)
        | 'summary' | 'filterAll' | 'selectAllShown' | 'selectGroupAria' | 'route' | 'climbs' | 'skips' | 'layerMeta' | 'linksIn' | 'findingsIn'
        | 'why' | 'goodLooksLike' | 'afterLooksLike' | 'topFilesSummary' | 'moreFiles' | 'showMore' | 'foldHint' | 'filteredTo' | 'clearFilter'
        | 'footerNote' | 'arrowCaption' | 'arrowAria'
        // Preview (`{from}`, `{to}`, `{file}`)
        | 'back' | 'backToPatterns' | 'before' | 'after' | 'afterPlanned' | 'tagHost' | 'tagAgent' | 'agentNote' | 'previewNote' | 'applyNote'
        | 'applying' | 'beforeAria' | 'afterAria' | 'withPort' | 'moreOfKind' | 'noComposerNote' | 'applyProgress' | 'cancel' | 'applyError' | 'resolveFailed' | 'sampleOf'
        // The Tower legend
        | 'legendTitle' | 'legendOffender' | 'legendPartner' | 'legendOther' | 'legendArrow' | 'legendClose',
        string
    > & {
        /** The rules table's sentences (`{from}`, `{to}`). */
        rules: Record<PatternsRuleKey, string>;
        /** The file card's anti-pattern block (`{title}`, `{limit}`, `{count}`). */
        block: Record<'tag' | 'fix' | 'fixAria' | 'showInTower' | 'reReview' | 'measureLines' | 'measureExports' | 'measureComplexity' | 'limit' | 'notMeasured' | 'reachesInto' | 'reachedBy' | 'measuresTitle', string>;
    };
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
        summary: '{anti} of {kinds}',
        filterAll: 'All',
        selectAllShown: 'Select all shown',
        selectGroupAria: 'Select {title}: {route}',
        route: '{from} → {to}',
        climbs: 'climbs a layer',
        skips: 'skips a layer',
        layerMeta: '{route} · {verdict} · {links}',
        linksIn: '{links} in {files}',
        findingsIn: '{findings} in {files}',
        why: 'Why',
        goodLooksLike: 'Good looks like',
        afterLooksLike: 'After the fix',
        topFilesSummary: 'Top files · {names}[[ · {more}]]',
        moreFiles: '+{count} more',
        showMore: 'Show more',
        foldHint: 'One card per kind and layer pair, not one per finding. {findings} fold into {groups}.',
        filteredTo: 'Showing {layer} only',
        clearFilter: 'Show all',
        footerNote: 'nothing changes until you apply',
        arrowCaption: 'imports (should not)',
        arrowAria: '{from} reaches up into {to}',
        back: 'Back',
        backToPatterns: '‹ Patterns',
        before: 'Before',
        after: 'After',
        afterPlanned: 'After (planned)',
        tagHost: 'Deterministic',
        tagAgent: 'Agent',
        agentNote: 'Agent: the real change appears on the branch',
        previewNote: 'Deterministic fixes show the exact change. Agent fixes show the plan here and the real change on the branch.',
        applyNote: 'Applies on a new branch · Undo any time',
        applying: 'Applying…',
        beforeAria: 'Before: {from} imports {to}',
        afterAria: 'After: {from} implements a port that {to} owns',
        withPort: '{file} + port',
        moreOfKind: '+{count} more of this kind',
        noComposerNote: 'No agent composer is connected, so only fixes the host can apply will run.',
        applyProgress: 'Applying {done} of {total}',
        cancel: 'Cancel',
        applyError: 'Applying stopped unexpectedly. Nothing further was changed.',
        resolveFailed: 'Open the first one in Resolve',
        sampleOf: 'Showing {shown} of {total}',
        legendTitle: 'Reading the Tower now',
        legendOffender: 'Breaks the rule (selected)',
        legendPartner: 'What it reaches into',
        legendOther: 'Not involved',
        legendArrow: 'A link that climbs a layer',
        legendClose: 'Close the legend',
        rules: {
            partitionViolationReason: '{from} should not depend on {to}: it reaches up a layer, so a change above can break what it builds on.',
            partitionViolationGood: 'Links only point down: Entry → Presentation → Application → Domain, with Infrastructure plugging into Domain\'s ports.',
            partitionViolationAfter: '{to} declares the port it needs and {from} implements it. The arrow now points down.',
            godModuleReason: 'This file does too many jobs. It is over at least one size limit, so every change lands here and it is hard to test or review.',
            godModuleGood: 'One job per file, every bar left of its limit mark.',
            godModuleAfter: 'One file per job, each under the limits.',
            genericReason: 'The review flagged this as something to fix.',
            genericGood: 'No finding of this kind is left after the fix.',
            genericAfter: 'The agent proposes the change on a branch, and you review the real diff before merging.',
        },
        block: {
            tag: 'Anti-pattern · {title}',
            fix: 'Fix',
            fixAria: 'Fix {title}',
            showInTower: 'Show in Tower',
            reReview: 'Re-review to get a fix for this',
            measureLines: 'Lines',
            measureExports: 'Exports',
            measureComplexity: 'Worst function complexity',
            limit: '/ limit {limit}',
            notMeasured: 'Not measured',
            reachesInto: 'Reaches into',
            reachedBy: 'Reached by',
            measuresTitle: 'Measures against their limits',
        },
    },
};
