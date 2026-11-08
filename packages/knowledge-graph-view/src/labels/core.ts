/** The top-level words of the view (title, states, lenses, findings, review, requests): the interface and its English defaults. */

import type { LensId, ReviewTarget } from '../types';

export type FindingKindLabels = Record<string, string>;

export interface CoreLabels {
    title: string;
    regionLabel: string;
    loading: string;
    /** Shown in the scene's corner while a fresh read replaces the graph on screen. */
    refreshing: string;
    /** The fresh read failed; the last graph stays drawn and this offers Retry. */
    refreshFailed: string;
    errorTitle: string;
    errorBody: string;
    retry: string;
    emptyTitle: string;
    emptyBody: string;
    /** A review EXISTS (a scope) but its graph could not be loaded — not the same as never reviewed. */
    loadFailedTitle: string;
    loadFailedBody: string;
    /** This machine holds no review of the root (PRD 41 A7); the server's copy is offered beside Review when the host can. */
    notHereTitle: string;
    notHereBody: string;
    /** The same, without the server sentence: not linked, or the project cannot be reached right now. */
    notHereBodyLocal: string;
    useServerCopy: string;
    reviewFolder: string;
    reviewTargetsLabel: string;
    targets: Record<ReviewTarget['kind'], string>;
    scopeLabel: string;
    searchLabel: string;
    searchPlaceholder: string;
    searchNoHits: string;
    lenses: Record<LensId, string>;
    lensHints: Record<LensId, string>;
    lensNotApplicable: string;
    lensNeedsJudgement: string;
    legendLabel: string;
    legend: Record<string, string>;
    statsLine: string;
    /** The Insights Files tile on a truncated graph: `{loaded}` of `{total}`. */
    filesLoaded: string;
    showAll: string;
    view3d: string;
    viewTower: string;
    viewList: string;
    /** The camera and drawer names (the switcher's and the header's buttons). */
    viewSystem: string;
    viewHeat: string;
    viewSequence: string;
    panelRun: string;
    panelCoverage: string;
    panelPatterns: string;
    panelApi: string;
    panelResolve: string;
    panelSimulate: string;
    viewGraph: string;
    /** The folder mind map. */
    viewMap: string;
    /** The transit map: lines from the entry points through the layers. */
    viewTransit: string;
    /** The view-mode group's name. */
    viewModesLabel: string;
    /** The graph / map's one-line how-to (also its SVG description). */
    graphHint: string;
    /** A node's accessible name: `{label}`, `{kind}`. */
    nodeAria: string;
    /** The mind map's "+N more" leaf; `{count}`. */
    mapMore: string;
    zoomLabel: string;
    zoomIn: string;
    zoomOut: string;
    zoomReset: string;
    // Insights
    insightsTitle: string;
    /** A headline metric's name, keyed by metric id. */
    metrics: Record<string, string>;
    chartKinds: string;
    chartPartitions: string;
    chartAreas: string;
    hotspotsIn: string;
    hotspotsOut: string;
    couplingTitle: string;
    chartFindings: string;
    partitionNone: string;
    /** An edge kind in a trace step (`references` → "references"), keyed by the camelCased kind. Unknown kinds show raw. */
    edgeKinds: Record<string, string>;
    /** A pack's name (`code`, `docs`). Unknown packs show raw. */
    packs: Record<string, string>;
    // Findings
    findingsTitle: string;
    /** The Findings heading when the list is narrower than the rail's findings: `{lens}` (its name), `{shown}`, `{total}`. */
    findingsNarrowed: string;
    /** `{scope}`: the station, line or whole graph the list is scoped to. */
    findingsEmpty: string;
    findingKinds: FindingKindLabels;
    severity: Record<'error' | 'warn' | 'info', string>;
    showFinding: string;
    fixWithAgent: string;
    /** Keyed by the requestKey suffix (`knowledgeGraph.fix.cloneGroup` → `cloneGroup`); `generic` is the fallback. */
    fix: Record<string, string>;
    // Findings panel — multiselect + nested lazy rows (PRD 38 §4.6)
    /** The selection toolbar above the findings (multiselect Fix with agent). */
    selectAll: string;
    clearSelection: string;
    /** The primary batch action; `{count}` is how many findings are selected. */
    fixSelected: string;
    /** Names the selection under the button; `{count}`. */
    selectedCount: string;
    /** Grouping of the findings into nested rows. */
    groupFindingsBy: string;
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
    factSaveFailed: string;
    factDeleteFailed: string;
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
    reviewPlanCost: string;
    /** Shown in the confirm chip while the host cannot price the judgement pass. */
    reviewPlanCostPending: string;
    /** Shown in the confirm chip when the judgement pass runs on the person's own local model. */
    reviewPlanCostLocal: string;
    reviewPlanning: string;
    reviewStop: string;
    /** Shown from Stop until the host settles. */
    reviewCancelled: string;
    reviewDoneTitle: string;
    reviewDoneBody: string;
    reviewContinue: string;
    reviewAborted: string;
    reviewFailed: string;
    /** The failure's own reason, under the sentence. `{message}`. */
    reviewFailedReason: string;
    /** Copies the failure's diagnostics (phase, message, detail, host, time) as plain text. */
    reviewCopyDetails: string;
    /** The always-available capture: copies the view + run state for a bug/improvement report. */
    copyDiagnostics: string;
    reviewProgress: string;
    phases: Record<'plan' | 'extract' | 'resolve' | 'mapped' | 'judge' | 'compare' | 'write' | 'analyse' | 'index' | 'done', string>;
}

export const CORE_DEFAULTS: CoreLabels = {
title: 'Knowledge',
regionLabel: 'Knowledge graph',
loading: 'Loading the knowledge graph…',
refreshing: 'Updating…',
refreshFailed: 'Couldn’t update — showing the last graph. Retry',
errorTitle: 'The knowledge graph could not load',
errorBody: 'Something went wrong reading this folder’s knowledge. Try again.',
retry: 'Try again',
emptyTitle: 'No folder reviewed yet',
emptyBody: 'Point it at a folder of code or documents. It reads every file once, builds a graph of what the folder says and how it connects, and remembers it, so questions are answered without reading the files again.',
loadFailedTitle: 'The review didn’t finish saving',
loadFailedBody: 'This folder has a review, but its graph could not be loaded — the review may have been cut short. Retry the load, or review the folder again to rebuild it.',
notHereTitle: 'Not reviewed on this machine',
notHereBody: 'This folder has no review here yet, so there is nothing to draw. Review it on this machine, or reuse what the project already holds so unchanged files are not read again.',
notHereBodyLocal: 'This folder has no review here yet, so there is nothing to draw. Review it on this machine.',
useServerCopy: 'Use the server’s copy',
reviewFolder: 'Review a folder',
reviewTargetsLabel: 'What to review',
targets: { workspace: 'This workspace’s files', upload: 'A folder on this device', drive: 'A connected drive', folder: 'A folder' },
scopeLabel: 'Reviewed folder',
searchLabel: 'Search the graph',
searchPlaceholder: 'Search files, sections, facts…',
searchNoHits: 'Nothing matches “{query}”.',
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
lensNotApplicable: 'This view does not apply to this folder.',
lensNeedsJudgement: 'Claims appear after a review with a model. Everything else works without one.',
legendLabel: 'Legend',
legend: {
    file: 'File', section: 'Section', symbol: 'Symbol', entity: 'Entity', claim: 'Claim', fact: 'Fact',
    missing: 'Missing target', stale: 'Stale', violation: 'Breaks a rule', cycle: 'Cycle', duplicate: 'Duplicate',
    contradicts: 'Contradicts', agrees: 'Agrees', unused: 'Unused', changed: 'Changed', edge: 'Reference',
},
statsLine: '{nodes} nodes · {edges} edges · {sources} sources',
filesLoaded: '{loaded} of {total} loaded',
showAll: 'Show all',
view3d: '3D',
viewTower: 'Tower',
viewList: 'List',
viewSystem: 'System',
viewHeat: 'Heat',
viewSequence: 'Sequence',
panelRun: 'Reviews',
panelCoverage: 'Coverage',
panelPatterns: 'Patterns',
panelApi: 'API',
panelResolve: 'Fix queue',
panelSimulate: 'Simulate',
viewGraph: 'Graph',
viewMap: 'Mind map',
viewTransit: 'Map',
viewModesLabel: 'View',
graphHint: 'Scroll or pinch to zoom, drag to pan, select a node for its details.',
nodeAria: '{label}, {kind}',
mapMore: '+{count} more',
zoomLabel: 'Zoom',
zoomIn: 'Zoom in',
zoomOut: 'Zoom out',
zoomReset: 'Fit to view',
insightsTitle: 'Insights',
metrics: {
    files: 'Files', sections: 'Sections', symbols: 'Symbols and entities', edges: 'Edges', findings: 'Findings',
    errors: 'Errors', warnings: 'Warnings', notes: 'Notes', cycles: 'Cycles', violations: 'Layer violations',
    cloneGroups: 'Duplicate sets', duplicates: 'Duplicated files', unusedFiles: 'Unused files', unusedExports: 'Unused exports',
    brokenLinks: 'Broken links', stale: 'Stale facts',
},
chartKinds: 'Nodes by kind',
chartPartitions: 'Files by partition',
chartAreas: 'Files by area',
hotspotsIn: 'Most depended on',
hotspotsOut: 'Depends on the most',
couplingTitle: 'Strongest coupling between partitions',
chartFindings: 'Findings by kind',
partitionNone: 'No partition',
edgeKinds: {
    references: 'references', contains: 'contains', links: 'links to', about: 'is about', mentions: 'mentions',
    supersedes: 'supersedes', contradicts: 'contradicts', agrees: 'agrees with', duplicate: 'duplicates',
    nearDuplicate: 'nearly duplicates', coChanged: 'changes with', imports: 'imports', calls: 'calls',
},
packs: { code: 'Code', docs: 'Documents' },
findingsTitle: 'Findings',
findingsNarrowed: 'Findings · {lens} lens ({shown} of {total})',
findingsEmpty: 'No open findings at {scope}.',
findingKinds: {
    godModule: 'God module', cycle: 'Cycle', cloneGroup: 'Clone group', nearDuplicate: 'Near-duplicate', partitionViolation: 'Layer violation',
    violation: 'Layer violation', unpartitioned: 'Unlayered files', unlayered: 'Unlayered files', stale: 'Stale knowledge',
    possibleSame: 'Possibly the same', brokenLink: 'Broken links', orphan: 'Orphan documents', unusedFile: 'Unused file',
    unusedExport: 'Unused exports', unusedDependency: 'Unused dependencies', unused: 'Unused code',
    contradiction: 'Contradiction', duplicateCopy: 'Stray copy of a project', other: 'Finding',
},
severity: { error: 'Error', warn: 'Warning', info: 'Note' },
showFinding: 'Show',
fixWithAgent: 'Fix with agent',
selectAll: 'Select all',
clearSelection: 'Clear',
fixSelected: 'Fix {count} with agent',
selectedCount: '{count} selected',
groupFindingsBy: 'kind',
fix: {
    cloneGroup: 'Consolidate the duplicated code[[ in clone group {group}]]: {items}. Extract one shared implementation and point every copy at it.',
    violation: 'Fix the layer violation: {items}. Move the dependency behind a port so {from} no longer uses {to} directly.',
    partitionViolation: 'Fix the layer violation: {items}. Move the dependency behind a port so {from} no longer uses {to} directly.',
    cycle: 'Break the dependency cycle between {items}.',
    unused: 'Remove the unused code in {items}, after checking nothing loads it dynamically.',
    unusedFile: 'Remove the unused files {items}, after checking nothing loads them dynamically.',
    unusedExport: 'Remove the unused exports in {items}.',
    unusedDependency: 'Remove the unused dependencies listed in {items}.',
    brokenLink: 'Repair the broken links in {file}: {items}.',
    orphan: 'Link these orphan documents from the documents that should reference them, or archive them: {items}.',
    contradiction: 'Reconcile [[§{sectionA} of ]]{fileA} with [[§{sectionB} of ]]{fileB}.',
    duplicateCopy: '{copy} looks like a stray copy of {original}. Check it, then delete it or add it to .builderforce/ignore.',
    nearDuplicate: 'Merge or differentiate these near-duplicate sections: {items}.',
    possibleSame: 'Check whether these are the same thing, and merge them if they are: {items}.',
    stale: 'Re-check the stale knowledge about {items} against the current source.',
    unlayered: 'Assign these files to a layer: {items}.',
    unpartitioned: 'Assign these files to a layer: {items}.',
    godModule: 'Split {items} into modules with one job each, each under the size limits ({linesLimit} lines, {exportsLimit} exports, worst-function complexity {complexityLimit}); keep behaviour unchanged and run the checks.',
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
factSaveFailed: 'The fact could not be saved. Your text is still here; try again.',
factDeleteFailed: 'The fact could not be deleted. Try again.',
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
reviewPlanCost: '≈ {cost}',
reviewPlanCostPending: 'Cost is shown after routing.',
reviewPlanCostLocal: 'Runs on your local model — no cost.',
reviewPlanning: 'Walking the folder…',
reviewStop: 'Stop',
reviewCancelled: 'Review cancelled. Nothing was written.',
reviewDoneTitle: 'Review finished',
reviewDoneBody: '{extracted} files read · {judged} sections judged · {facts} facts written',
reviewContinue: 'Continue',
reviewAborted: 'Review stopped. What was written stays.',
reviewFailed: 'The review failed. Nothing more was written.',
reviewFailedReason: 'Reason: {message}',
reviewCopyDetails: 'Copy details',
copyDiagnostics: 'Copy diagnostics',
reviewProgress: '{phase} · {done} of {total}',
phases: {
    plan: 'Planning', extract: 'Reading', resolve: 'Resolving', mapped: 'Map complete', judge: 'Judging', compare: 'Comparing', write: 'Writing', analyse: 'Mapping the code', index: 'Indexing', done: 'Done',
},
};
