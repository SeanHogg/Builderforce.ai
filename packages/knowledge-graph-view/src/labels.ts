/**
 * Every word the view shows, as ONE typed object with English defaults — the brain-ui
 * pattern (`SurfaceHeaderLabels`). Every host passes its `knowledgeGraph.*` catalog through
 * THE ONE mapper (`@builderforce/knowledge-browser` `knowledgeGraphLabels`; the web feeds it
 * next-intl's `t.raw`, Rovr the same five web catalogs), so this package hardcodes no
 * user-facing string outside these defaults.
 *
 * Templates use `{name}` placeholders and are filled by {@link fillTemplate} — never by
 * the host's i18n runtime, so a template's params are the finding's own and nothing
 * else (the Fix-with-agent requests are a FIXED list: never a model call).
 */

import type { LensId, ReviewTarget } from './types';

export { camelKind, fillTemplate } from './template';

export type FindingKindLabels = Record<string, string>;

export interface KnowledgeGraphLabels {
    title: string;
    regionLabel: string;
    loading: string;
    errorTitle: string;
    errorBody: string;
    retry: string;
    emptyTitle: string;
    emptyBody: string;
    reviewFolder: string;
    reviewTargetsLabel: string;
    targets: Record<ReviewTarget['kind'], string>;
    scopeLabel: string;
    searchLabel: string;
    searchPlaceholder: string;
    searchNoHits: string;
    lensesLabel: string;
    lenses: Record<LensId, string>;
    lensHints: Record<LensId, string>;
    lensNotApplicable: string;
    lensNeedsJudgement: string;
    legendLabel: string;
    legend: Record<string, string>;
    statsLine: string;
    truncatedNote: string;
    focusedNote: string;
    showAll: string;
    view3d: string;
    viewList: string;
    listFallbackNote: string;
    partitionNone: string;
    // Findings
    findingsTitle: string;
    findingsEmpty: string;
    findingKinds: FindingKindLabels;
    severity: Record<'error' | 'warn' | 'info', string>;
    showFinding: string;
    fixWithAgent: string;
    /** Keyed by the requestKey suffix (`knowledgeGraph.fix.cloneGroup` → `cloneGroup`); `generic` is the fallback. */
    fix: Record<string, string>;
    // Node panel
    nodePanelTitle: string;
    nodeKind: string;
    nodePack: string;
    nodePartition: string;
    nodeOrigin: string;
    origins: Record<'extracted' | 'model' | 'human' | 'agent', string>;
    staleMark: string;
    factsTitle: string;
    claimsTitle: string;
    noFacts: string;
    addFact: string;
    addFactPlaceholder: string;
    saveFact: string;
    factSaved: string;
    deleteFact: string;
    deleteFactConfirm: string;
    confirmDelete: string;
    cancel: string;
    close: string;
    trace: string;
    // Trace
    traceTitle: string;
    traceEmpty: string;
    traceTruncated: string;
    copyMermaid: string;
    copied: string;
    copyFailed: string;
    traceStep: string;
    traceBack: string;
    traceUpward: string;
    traceSkips: string;
    traceCycle: string;
    // Partition matrix
    matrixTitle: string;
    matrixFrom: string;
    matrixTo: string;
    matrixEmpty: string;
    // Compare
    compareTitle: string;
    compareEmpty: string;
    compareBefore: string;
    compareAfter: string;
    compareBetter: string;
    compareWorse: string;
    compareSame: string;
    compareNodes: string;
    compareAdded: string;
    compareResolved: string;
    compareIncomparable: string;
    /** The Before/After control's group name (shown when the host keeps a baseline). */
    revisionLabel: string;
    // Review
    reviewPlanTitle: string;
    reviewPlanByPack: string;
    reviewPlanUnchanged: string;
    reviewPlanModelCalls: string;
    reviewPlanCost: string;
    reviewPlanSkipped: string;
    reviewConfirm: string;
    reviewCancel: string;
    reviewRereviewAll: string;
    reviewPlanning: string;
    reviewStop: string;
    reviewCancelled: string;
    reviewDoneTitle: string;
    reviewDoneBody: string;
    reviewUnjudged: string;
    reviewContinue: string;
    reviewAborted: string;
    reviewFailed: string;
    reviewProgress: string;
    phases: Record<'plan' | 'extract' | 'resolve' | 'judge' | 'write' | 'index' | 'done', string>;
}

export const DEFAULT_KNOWLEDGE_GRAPH_LABELS: KnowledgeGraphLabels = {
    title: 'Knowledge',
    regionLabel: 'Knowledge graph',
    loading: 'Loading the knowledge graph…',
    errorTitle: 'The knowledge graph could not load',
    errorBody: 'Something went wrong reading this folder’s knowledge. Try again.',
    retry: 'Try again',
    emptyTitle: 'No folder reviewed yet',
    emptyBody: 'Point it at a folder of code or documents. It reads every file once, builds a graph of what the folder says and how it connects, and remembers it, so questions are answered without reading the files again.',
    reviewFolder: 'Review a folder',
    reviewTargetsLabel: 'What to review',
    targets: { workspace: 'This workspace’s files', upload: 'A folder on this device', drive: 'A connected drive', folder: 'A folder' },
    scopeLabel: 'Reviewed folder',
    searchLabel: 'Search the graph',
    searchPlaceholder: 'Search files, sections, facts…',
    searchNoHits: 'Nothing matches “{query}”.',
    lensesLabel: 'Lenses',
    lenses: {
        structure: 'Structure', partitions: 'Partitions', duplication: 'Duplication', claims: 'Claims', links: 'Links',
        unused: 'Unused', knowledge: 'Knowledge', live: 'Live', compare: 'Compare',
    },
    lensHints: {
        structure: 'What references what, sized by importance.',
        partitions: 'Layers, and the arcs that break their rules.',
        duplication: 'Exact clones and near-duplicate sections.',
        claims: 'What the documents claim, and where they disagree.',
        links: 'Links and references, with the broken ones.',
        unused: 'Files, exports and dependencies nothing uses.',
        knowledge: 'Facts and entities on their sources; stale ones marked.',
        live: 'What changed in this run, and what changed together.',
        compare: 'Before and after: what got better or worse.',
    },
    lensNotApplicable: 'This lens does not apply to this folder.',
    lensNeedsJudgement: 'Claims appear after a review with a model. Everything else works without one.',
    legendLabel: 'Legend',
    legend: {
        file: 'File', section: 'Section', symbol: 'Symbol', entity: 'Entity', claim: 'Claim', fact: 'Fact',
        missing: 'Missing target', stale: 'Stale', violation: 'Breaks a rule', cycle: 'Cycle', duplicate: 'Duplicate',
        contradicts: 'Contradicts', agrees: 'Agrees', unused: 'Unused', changed: 'Changed', edge: 'Reference',
    },
    statsLine: '{nodes} nodes · {edges} edges · {sources} sources',
    truncatedNote: 'Showing the most important part of a large graph. Search reaches everything.',
    focusedNote: 'Showing the top {count} nodes.',
    showAll: 'Show all',
    view3d: '3D',
    viewList: 'List',
    listFallbackNote: 'Showing the list view.',
    partitionNone: 'No partition',
    findingsTitle: 'Findings',
    findingsEmpty: 'Nothing to act on in this lens.',
    findingKinds: {
        cycle: 'Cycle', cloneGroup: 'Clone group', nearDuplicate: 'Near-duplicate', partitionViolation: 'Layer violation',
        violation: 'Layer violation', unpartitioned: 'Unlayered files', unlayered: 'Unlayered files', stale: 'Stale knowledge',
        possibleSame: 'Possibly the same', brokenLink: 'Broken links', orphan: 'Orphan documents', unusedFile: 'Unused file',
        unusedExport: 'Unused exports', unusedDependency: 'Unused dependencies', unused: 'Unused code',
        contradiction: 'Contradiction', other: 'Finding',
    },
    severity: { error: 'Error', warn: 'Warning', info: 'Note' },
    showFinding: 'Show',
    fixWithAgent: 'Fix with agent',
    fix: {
        cloneGroup: 'Consolidate the duplicated code in clone group {group}: {items}. Extract one shared implementation and point every copy at it.',
        violation: 'Fix the layer violation: {items}. Move the dependency behind a port so {from} no longer uses {to} directly.',
        partitionViolation: 'Fix the layer violation: {items}. Move the dependency behind a port so {from} no longer uses {to} directly.',
        cycle: 'Break the dependency cycle between {items}.',
        unused: 'Remove the unused code in {items}, after checking nothing loads it dynamically.',
        unusedFile: 'Remove the unused files {items}, after checking nothing loads them dynamically.',
        unusedExport: 'Remove the unused exports in {items}.',
        unusedDependency: 'Remove the unused dependencies listed in {items}.',
        brokenLink: 'Repair the broken links in {file}: {items}.',
        orphan: 'Link these orphan documents from the documents that should reference them, or archive them: {items}.',
        contradiction: 'Reconcile the contradiction between {items}.',
        nearDuplicate: 'Merge or differentiate these near-duplicate sections: {items}.',
        possibleSame: 'Check whether these are the same thing, and merge them if they are: {items}.',
        stale: 'Re-check the stale knowledge about {items} against the current source.',
        unlayered: 'Assign these files to a layer: {items}.',
        unpartitioned: 'Assign these files to a layer: {items}.',
        generic: 'Look into this finding and fix it: {items}.',
    },
    nodePanelTitle: 'Details',
    nodeKind: 'Kind',
    nodePack: 'Pack',
    nodePartition: 'Partition',
    nodeOrigin: 'Origin',
    origins: { extracted: 'Read from the source', model: 'Judged by a model', human: 'Added by a person', agent: 'Added by an agent' },
    staleMark: 'Stale: the source changed after this was judged',
    factsTitle: 'Facts',
    claimsTitle: 'Claims',
    noFacts: 'Nothing is remembered about this yet.',
    addFact: 'Add fact',
    addFactPlaceholder: 'What should every agent know about this?',
    saveFact: 'Save fact',
    factSaved: 'Fact saved.',
    deleteFact: 'Delete fact',
    deleteFactConfirm: 'Delete this fact and its relations? Every host and agent will stop seeing it.',
    confirmDelete: 'Confirm delete',
    cancel: 'Cancel',
    close: 'Close',
    trace: 'Trace',
    traceTitle: 'Trace',
    traceEmpty: 'Nothing is reached from here.',
    traceTruncated: 'The trace was cut short.',
    copyMermaid: 'Copy as Mermaid',
    copied: 'Copied',
    copyFailed: 'Copy failed. Select the text below instead.',
    traceStep: '{from} {kind} {to}',
    traceBack: 'already visited',
    traceUpward: 'climbs a layer',
    traceSkips: 'skips a layer',
    traceCycle: 'cycle',
    matrixTitle: 'Partitions',
    matrixFrom: 'From',
    matrixTo: 'To',
    matrixEmpty: 'No references cross a partition.',
    compareTitle: 'Before and after',
    compareEmpty: 'Compare needs two reviews of this folder. Review it again after a change.',
    compareBefore: 'Before',
    compareAfter: 'After',
    compareBetter: 'Better',
    compareWorse: 'Worse',
    compareSame: 'Same',
    compareNodes: 'Nodes',
    compareAdded: 'Appeared',
    compareResolved: 'Resolved',
    compareIncomparable: 'Before and after were measured differently, so a missing finding is not counted as resolved.',
    revisionLabel: 'Revision',
    reviewPlanTitle: 'Review {title}?',
    reviewPlanByPack: '{pack}: {count} files',
    reviewPlanUnchanged: '{count} unchanged since the last review',
    reviewPlanModelCalls: '≈ {count} model calls',
    reviewPlanCost: '≈ {cost}',
    reviewPlanSkipped: '{count} skipped',
    reviewConfirm: 'Review',
    reviewCancel: 'Cancel',
    reviewRereviewAll: 'Re-review all',
    reviewPlanning: 'Walking the folder…',
    reviewStop: 'Stop',
    reviewCancelled: 'Review cancelled. Nothing was written.',
    reviewDoneTitle: 'Review finished',
    reviewDoneBody: '{extracted} files read · {judged} sections judged · {facts} facts written',
    reviewUnjudged: '{count} sections were left for later by the budget.',
    reviewContinue: 'Continue',
    reviewAborted: 'Review stopped. What was written stays.',
    reviewFailed: 'The review failed. Nothing more was written.',
    reviewProgress: '{phase} · {done} of {total}',
    phases: {
        plan: 'Planning', extract: 'Reading', resolve: 'Resolving', judge: 'Judging', write: 'Writing', index: 'Indexing', done: 'Done',
    },
};

/** Host labels over the defaults, one level deep for the nested maps. */
export function resolveLabels(partial?: Partial<KnowledgeGraphLabels>): KnowledgeGraphLabels {
    if (!partial) return DEFAULT_KNOWLEDGE_GRAPH_LABELS;
    const d = DEFAULT_KNOWLEDGE_GRAPH_LABELS;
    return {
        ...d, ...partial,
        targets: { ...d.targets, ...partial.targets },
        lenses: { ...d.lenses, ...partial.lenses },
        lensHints: { ...d.lensHints, ...partial.lensHints },
        legend: { ...d.legend, ...partial.legend },
        findingKinds: { ...d.findingKinds, ...partial.findingKinds },
        severity: { ...d.severity, ...partial.severity },
        fix: { ...d.fix, ...partial.fix },
        origins: { ...d.origins, ...partial.origins },
        phases: { ...d.phases, ...partial.phases },
    };
}
