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
import type { Layer, Provenance } from './surface/layers';
import type { ChannelId, MetricId, PresetId } from './surface/overlays';
import type { NoteKey, QuestionId } from './surface/questions';

export { camelKind, fillTemplate } from './template';

export type FindingKindLabels = Record<string, string>;

/** The keys of `KnowledgeGraphLabels` that hold one string (a registry row names its label by one). */
export type StringLabelKey = { [K in keyof KnowledgeGraphLabels]: KnowledgeGraphLabels[K] extends string ? K : never }[keyof KnowledgeGraphLabels];

/** The words of the transit-map surface: header, lines, overlays, questions, path strip, Act panel. */
export interface SurfaceLabels {
    spineLabel: string;
    panelsLabel: string;
    overlaysButton: string;
    overlaysTitle: string;
    /** The overlay button's name: `{preset}`. */
    presetLabel: string;
    presets: Record<PresetId | 'custom', string>;
    channels: Record<ChannelId | 'pins', string>;
    metricNames: Record<MetricId, string>;
    notSetUp: string;
    on: string;
    off: string;
    questionsLabel: string;
    moreQuestions: string;
    questions: Record<QuestionId, string>;
    /** A question's answer line: `{count}` stations. */
    answerCount: string;
    answerNone: string;
    /** The question needs data this folder has not collected. */
    answerNotSetUp: string;
    /** A lit station's note; `{value}`. */
    notes: Record<NoteKey, string>;
    linesTitle: string;
    linesButton: string;
    linesEmpty: string;
    /** `{name}`. */
    lineName: string;
    /** `{count}`. */
    lineStops: string;
    /** `{name}`. */
    stationsOn: string;
    stationsPick: string;
    /** `{count}` entry points left without a line. */
    omittedLines: string;
    /** `{files}`, `{layer}`. */
    stationMeta: string;
    legendTitle: string;
    /** A legend row: `{channel}`, `{metric}`. */
    legendRow: string;
    /** `{count}` lines. */
    interchange: string;
    terminus: Record<'data' | 'external' | 'end', string>;
    untestedSegment: string;
    /** The map's SVG description: `{lines}`, `{stations}`. */
    mapDescription: string;
    /** A station's accessible name: `{name}`, `{layer}`, `{files}`. */
    stationAria: string;
    /** A pin's accessible name: `{count}`, `{name}`. */
    pinAria: string;
    /** Stations left off the map by its cap: `{count}`. */
    moreStations: string;
    layers: Record<Layer | 'other', string>;
    pathTitle: string;
    pathEmpty: string;
    /** `{n}` of `{total}`. */
    pathStep: string;
    pathBack: string;
    pathNext: string;
    /** The edge between two stops: `{kind}`, `{count}`. */
    pathHop: string;
    actTitle: string;
    /** `{scope}`. */
    actScope: string;
    actScopeAll: string;
    showFiles: string;
    /** `{level}` of 5. */
    levelOf5: string;
    stationFacts: string;
    provenance: Record<Provenance, string>;
    /** Resolve on a finding row. */
    resolveFinding: string;
    /** The Resolve button's accessible name, which says which finding: `{title}`. */
    resolveFindingAria: string;
    /** The Tower draws only the first pipes: `{count}`. */
    pipesCapped: string;
    /** Names the colours of the System camera's finding bar. */
    kindsLegend: string;
    /** A sequence message between stops with no reference between them. */
    noDirectReference: string;
    /** The contract-tests request names only the first `{count}` endpoints. */
    testsCapped: string;
    /** A screenshot over the size limit: `{size}` MB. */
    imageTooLarge: string;
    /** The time slider draws only the latest `{count}` commits. */
    historyCapped: string;
    /** The done card: `{count}` files were not stored (the list says which and why). */
    skippedUploads: string;
    /** Why a file was skipped, by reason id (`too-large` is `tooLarge`); a reason this build has no words for shows as sent. */
    skipReasons: Record<'tooLarge' | 'unreadable' | 'rateLimited' | 'unsupported' | 'other', string>;
    /** The System camera: `{tiers}`, `{components}`; a component's name `{name}`, `{files}`, `{findings}`. */
    system: Record<'description' | 'componentAria' | 'antiBar' | 'data' | 'dataEmpty' | 'empty', string>;
    /** The Heat camera: `{layers}`, `{components}`; `{name}`, `{files}`; the legend `{size}`, `{colour}`, `{bar}`. */
    heat: Record<'description' | 'cellAria' | 'legend' | 'empty', string>;
    /** The Sequence camera: `{stops}`, `{messages}`; `{from}`, `{to}`, `{label}`. */
    sequence: Record<'description' | 'empty' | 'messageAria', string>;
    sync: Record<
        'loading' | 'failed' | 'localTitle' | 'serverTitle' | 'files' | 'edges' | 'docs' | 'notUploaded' | 'pipelineTitle' | 'skippedTitle'
        | 'skippedNone' | 'skippedRow' | 'skippedRowNoSize' | 'edgesNotMeasured' | 'skippedUnknown' | 'truncatedNote' | 'sourcesTitle' | 'excludedTitle' | 'excludedNote' | 'barAria',
        string
    >;
    syncSteps: Record<'walk' | 'graph' | 'upload' | 'match' | 'analyse' | 'skipped', string>;
    syncStates: Record<'ok' | 'pending' | 'attention', string>;
    syncSources: Record<'code' | 'docs' | 'coverage' | 'usage' | 'traces' | 'openapi' | 'history' | 'owners', string>;
    syncExcluded: Record<'nested' | 'worktrees' | 'local' | 'vendored', string>;
    sourceStates: Record<'collected' | 'estimated' | 'absent', string>;
    /** `{count}`, `{total}`; `{file}`, `{complexity}`, `{coverage}`. */
    coverage: Record<
        'notSetUpTitle' | 'notSetUpBody' | 'kpiFiles' | 'kpiFilesValue' | 'kpiMean' | 'kpiComplexity' | 'kpiRisky' | 'scatterTitle' | 'scatterAria'
        | 'axisX' | 'axisY' | 'gapsTitle' | 'gapsNone' | 'gapRow' | 'runWithValues' | 'promptTests' | 'promptText' | 'noComplexity',
        string
    >;
    /** `{family}`, `{layer}`, `{count}`. */
    patterns: Record<
        'notSetUpTitle' | 'notSetUpBody' | 'matrixTitle' | 'antiRow' | 'cellAria' | 'listTitle' | 'listRow' | 'listHint' | 'antiTitle' | 'antiNone'
        | 'resolve' | 'showInTower' | 'lights',
        string
    >;
    /** `{file}`, `{count}`, `{names}`, `{routes}`. */
    api: Record<
        'notSetUpTitle' | 'notSetUpBody' | 'kpiEndpoints' | 'kpiUndocumented' | 'contractMissing' | 'documented' | 'undocumented' | 'callers'
        | 'noCallers' | 'downloadFailed' | 'tryIt' | 'requestLine' | 'copyCurl' | 'exportOpenapi' | 'exportPostman' | 'contractTests' | 'contractTestsText' | 'groupAria',
        string
    >;
    /** `{branch}`, `{count}`. */
    resolve: Record<
        'empty' | 'provenanceLabel' | 'fixTitle' | 'fixIntro' | 'applyFix' | 'applying' | 'applied' | 'appliedNoBranch' | 'changedFiles' | 'failed'
        | 'promptTitle' | 'promptIntro' | 'prompt' | 'noComposer' | 'checksTitle' | 'checkFiles' | 'checkStations' | 'checkReview' | 'undoNote' | 'show',
        string
    >;
    /** `{path}`, `{values}`. */
    simulate: Record<'pathTitle' | 'pathEmpty' | 'valuesLabel' | 'valuesPlaceholder' | 'run' | 'requestText' | 'noValues' | 'sent' | 'noComposer' | 'note', string>;
    /** `{description}`, `{path}`, `{findings}`. */
    pinpoint: Record<
        'label' | 'button' | 'hint' | 'reading' | 'failed' | 'noMatch' | 'thumbAlt' | 'descriptionTitle' | 'anchorsTitle' | 'matchesTitle' | 'diagnose'
        | 'diagnoseText' | 'noFindings' | 'clear' | 'clearAria' | 'dropHere' | 'notImage',
        string
    >;
    pinpointProvenance: Record<'vision' | 'exact' | 'catalog' | 'import', string>;
    /** `{title}`, `{at}`, `{count}`. */
    time: Record<'label' | 'aria' | 'now' | 'commitAria' | 'changed', string>;
}

export interface KnowledgeGraphLabels {
    title: string;
    regionLabel: string;
    loading: string;
    errorTitle: string;
    errorBody: string;
    retry: string;
    emptyTitle: string;
    emptyBody: string;
    /** A review EXISTS (a scope) but its graph could not be loaded — not the same as never reviewed. */
    loadFailedTitle: string;
    loadFailedBody: string;
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
    /** The camera and drawer names (the switcher's and the header's buttons). */
    viewSystem: string;
    viewHeat: string;
    viewSequence: string;
    panelSync: string;
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
    /** A mind-map folder's accessible name: `{name}`, `{count}` files. */
    mapBranch: string;
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
    /** One batch request's intro line; `{count}`. */
    fixBatch: string;
    /** Grouping of the findings into nested rows. */
    groupFindingsBy: string;
    /** A lazy group row's collapsed summary; `{count}`. */
    findingsCollapsed: string;
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
    reviewPlanTitle: string;
    reviewPlanByPack: string;
    reviewPlanUnchanged: string;
    reviewPlanModelCalls: string;
    reviewPlanCost: string;
    /** Shown in the confirm chip while the host cannot price the judgement pass. */
    reviewPlanCostPending: string;
    /** Shown in the confirm chip when the judgement pass runs on the person's own local model. */
    reviewPlanCostLocal: string;
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
    /** The failure's own reason, under the sentence. `{message}`. */
    reviewFailedReason: string;
    /** Copies the failure's diagnostics (phase, message, detail, host, time) as plain text. */
    reviewCopyDetails: string;
    /** The always-available capture: copies the view + run state for a bug/improvement report. */
    copyDiagnostics: string;
    reviewProgress: string;
    phases: Record<'plan' | 'extract' | 'resolve' | 'judge' | 'write' | 'index' | 'done', string>;
    surface: SurfaceLabels;
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
    loadFailedTitle: 'The review didn’t finish saving',
    loadFailedBody: 'This folder has a review, but its graph could not be loaded — the review may have been cut short. Retry the load, or review the folder again to rebuild it.',
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
    view3d: 'Tower',
    viewList: 'List',
    viewSystem: 'System',
    viewHeat: 'Heat',
    viewSequence: 'Sequence',
    panelSync: 'Sync',
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
    mapBranch: '{name}, {count} files',
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
    selectAll: 'Select all',
    clearSelection: 'Clear',
    fixSelected: 'Fix {count} with agent',
    selectedCount: '{count} selected',
    fixBatch: 'Resolve these {count} findings together, in one change:',
    groupFindingsBy: 'kind',
    findingsCollapsed: '{count} findings — expand to load',
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
    reviewPlanTitle: 'Review {title}?',
    reviewPlanByPack: '{pack}: {count} files',
    reviewPlanUnchanged: '{count} unchanged since the last review',
    reviewPlanModelCalls: '≈ {count} model calls',
    reviewPlanCost: '≈ {cost}',
    reviewPlanCostPending: 'Cost is shown after routing.',
    reviewPlanCostLocal: 'Runs on your local model — no cost.',
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
    reviewFailedReason: 'Reason: {message}',
    reviewCopyDetails: 'Copy details',
    copyDiagnostics: 'Copy diagnostics',
    reviewProgress: '{phase} · {done} of {total}',
    phases: {
        plan: 'Planning', extract: 'Reading', resolve: 'Resolving', judge: 'Judging', write: 'Writing', index: 'Indexing', done: 'Done',
    },
    surface: {
        spineLabel: 'Where you are',
        panelsLabel: 'Panels',
        overlaysButton: 'Overlays',
        overlaysTitle: 'What the map shows',
        presetLabel: '{preset} overlays',
        presets: { risk: 'Risk', quality: 'Quality', activity: 'Activity', ownership: 'Ownership', custom: 'Custom' },
        channels: { colour: 'Colour', size: 'Size · height', ring: 'Ring · fill · bar', width: 'Line width', pulse: 'Pulse', outline: 'Outline', pins: 'Issue pins' },
        metricNames: { anti: 'Anti-patterns', cx: 'Complexity', cov: 'Coverage gap', use: 'Usage', churn: 'Churn', changed: 'Changed', owner: 'Owner', none: 'Off' },
        notSetUp: 'Not set up',
        on: 'On',
        off: 'Off',
        questionsLabel: 'Questions',
        moreQuestions: 'More questions',
        questions: {
            where: 'Where does it go?', wrong: 'What is wrong?', untested: 'What has no test?', patterns: 'What patterns are here?',
            changed: 'What changed?', callers: 'Who else calls these?', copied: 'What is copied?', unused: 'What is never called?',
            claims: 'What do the docs claim?', layers: 'How is it layered?', knowledge: 'What do we know about it?',
        },
        answerCount: '{count} stations',
        answerNone: 'No station matches.',
        answerNotSetUp: 'Not set up: this needs data that has not been collected.',
        notes: {
            patterns: '{value}', copied: '{value} clone groups', unused: '{value} unused', claims: '{value} claims',
            layers: '{value}', knowledge: '{value} facts', changed: 'Changed',
        },
        linesTitle: 'Lines',
        linesButton: 'Lines',
        linesEmpty: 'No entry points were found, so there are no lines.',
        lineName: '{name} line',
        lineStops: '{count} stops',
        stationsOn: 'Stations on {name}',
        stationsPick: 'Pick a line to list its stations.',
        omittedLines: '{count} more entry points are not drawn as lines.',
        stationMeta: '{files} files · {layer}',
        legendTitle: 'On the map',
        legendRow: '{channel}: {metric}',
        interchange: 'Interchange: {count} lines',
        terminus: { data: 'Data store', external: 'External service', end: 'Ends here' },
        untestedSegment: 'Dashed: no test covers it',
        mapDescription: '{lines} lines across {stations} stations. Select a station for its details.',
        stationAria: '{name}, {layer}, {files} files',
        pinAria: '{count} findings at {name}',
        moreStations: '+{count} more stations are not drawn.',
        layers: {
            entry: 'Entry points', presentation: 'Presentation', application: 'Application', domain: 'Domain',
            infrastructure: 'Infrastructure', other: 'Other',
        },
        pathTitle: 'Path',
        pathEmpty: 'Pick a line or a station to read its path.',
        pathStep: 'Stop {n} of {total}',
        pathBack: 'Previous stop',
        pathNext: 'Next stop',
        pathHop: '{kind} · {count}',
        actTitle: 'Act',
        actScope: 'Scope: {scope}',
        actScopeAll: 'Whole graph',
        showFiles: 'Show files',
        levelOf5: '{level} of 5',
        stationFacts: 'About this station',
        provenance: { deterministic: 'Deterministic', heuristic: 'Heuristic', runtime: 'Runtime' },
        resolveFinding: 'Resolve',
        resolveFindingAria: 'Resolve: {title}',
        pipesCapped: 'Showing only the first {count} pipes.',
        kindsLegend: 'Finding kinds',
        noDirectReference: 'no direct reference',
        testsCapped: 'The request names only the first {count} endpoints.',
        imageTooLarge: 'That image is larger than {size} MB.',
        historyCapped: 'Showing only the latest {count} commits.',
        skippedUploads: '{count} files were not stored.',
        skipReasons: { tooLarge: 'Too large to store', unreadable: 'Could not be read', rateLimited: 'Server was busy', unsupported: 'Not a supported file', other: 'Other reason' },
        system: {
            description: 'System view: {tiers} tiers, {components} components. Select a component for its details.',
            componentAria: '{name}, {files} files, {findings} findings',
            antiBar: 'Findings by kind',
            data: 'Data and external services',
            dataEmpty: 'No data store or external service ends a line.',
            empty: 'There are no components to draw.',
        },
        heat: {
            description: 'Heat grid: {layers} layers, {components} components. Select a cell for its details.',
            cellAria: '{name}, {files} files',
            legend: 'Cell size: {size} · Colour: {colour} · Bar: {bar}',
            empty: 'There are no components to draw.',
        },
        sequence: {
            description: 'Sequence of {stops} stops and {messages} messages.',
            empty: 'Pick a line or a station to draw its sequence.',
            messageAria: '{from} to {to}: {label}',
        },
        sync: {
            loading: 'Reading the sync status…',
            failed: 'The sync status could not be read.',
            localTitle: 'Local',
            serverTitle: 'Server',
            files: 'Files',
            edges: 'Edges',
            docs: 'Docs',
            notUploaded: 'Not uploaded yet',
            pipelineTitle: 'Pipeline',
            skippedTitle: 'Skipped files',
            skippedNone: 'Nothing was skipped.',
            skippedRow: '{path} · {size} · {reason}',
            skippedRowNoSize: '{path} · {reason}',
            edgesNotMeasured: 'Not measured',
            skippedUnknown: 'Unknown: no review recorded what it skipped.',
            truncatedNote: 'The graph was cut short (truncated).',
            sourcesTitle: 'Data sources',
            excludedTitle: 'Excluded folders',
            excludedNote: 'These folders are never read.',
            barAria: '{label}: local {local}, server {server}',
        },
        syncSteps: { walk: 'Files walked', graph: 'Graph built', upload: 'Uploaded', match: 'Server matches local', analyse: 'Sources collected', skipped: 'Nothing skipped' },
        syncStates: { ok: 'Done', pending: 'Waiting', attention: 'Needs attention' },
        syncSources: { code: 'Code', docs: 'Documents', coverage: 'Coverage', usage: 'Usage', traces: 'Traces', openapi: 'OpenAPI', history: 'History', owners: 'Owners' },
        syncExcluded: { nested: 'Nested git checkouts', worktrees: '.worktrees folders', local: '*.local folders', vendored: 'Vendored _*_src folders' },
        sourceStates: { collected: 'Collected', estimated: 'Estimated', absent: 'Not set up' },
        coverage: {
            notSetUpTitle: 'Coverage is not set up',
            notSetUpBody: 'No coverage file (coverage-final.json or lcov.info) was found under the reviewed folder, so no coverage number is shown. Run the tests with coverage on, then review the folder again.',
            kpiFiles: 'Files with coverage',
            kpiFilesValue: '{count} of {total}',
            kpiMean: 'Mean coverage',
            kpiComplexity: 'Total complexity',
            kpiRisky: 'Complex and under-tested',
            scatterTitle: 'Complexity against coverage',
            scatterAria: '{count} files plotted. Complexity runs left to right and coverage bottom to top.',
            axisX: 'Complexity',
            axisY: 'Coverage',
            gapsTitle: 'Riskiest gaps',
            gapsNone: 'No complex file is under-tested.',
            gapRow: '{complexity} complexity · {coverage} covered',
            runWithValues: 'Run with values',
            promptTests: 'Prompt tests',
            promptText: 'Write tests for {file}. It has complexity {complexity} and {coverage} line coverage. Cover the untested branches, run them and report the new coverage.',
            noComplexity: 'Complexity has not been measured.',
        },
        patterns: {
            notSetUpTitle: 'Patterns are not set up',
            notSetUpBody: 'No pattern was detected in this folder, so the matrix is empty.',
            matrixTitle: 'Pattern families by layer',
            antiRow: 'Anti-pattern',
            cellAria: '{family}, {layer}: {count}',
            listTitle: 'Patterns found',
            listRow: '{count} files',
            listHint: 'Heuristic: read from names, exports, imports and size.',
            antiTitle: 'Anti-patterns',
            antiNone: 'No anti-patterns were found.',
            resolve: 'Resolve',
            showInTower: 'Show in Tower',
            lights: '{family} lights {count} stations',
        },
        api: {
            notSetUpTitle: 'No endpoints found',
            notSetUpBody: 'No route registration was found. Routes are read from Hono and Express registrations.',
            kpiEndpoints: 'Endpoints',
            kpiUndocumented: 'Undocumented',
            contractMissing: 'There is no OpenAPI contract in this folder, so every endpoint is undocumented.',
            documented: 'Documented',
            undocumented: 'Undocumented',
            callers: 'Called from: {names}',
            noCallers: 'No station imports this file.',
            downloadFailed: 'The file could not be downloaded.',
            tryIt: 'Try it',
            requestLine: 'Request',
            copyCurl: 'Copy as curl',
            exportOpenapi: 'Export OpenAPI skeleton',
            exportPostman: 'Export Postman collection',
            contractTests: 'Contract tests',
            contractTestsText: 'Write contract tests for these endpoints from the OpenAPI skeleton, run them and report each result: {routes}.',
            groupAria: '{file}: {count} endpoints',
        },
        resolve: {
            empty: 'Choose Resolve on a finding to work on it here.',
            provenanceLabel: 'Source',
            fixTitle: 'Deterministic fix',
            fixIntro: 'A codemod can fix this kind of finding.',
            applyFix: 'Apply the fix',
            applying: 'Applying…',
            applied: 'Applied on branch {branch}.',
            appliedNoBranch: 'Applied.',
            changedFiles: '{count} files changed',
            failed: 'The fix could not be applied.',
            promptTitle: 'Ask the agent',
            promptIntro: 'No codemod exists for this kind, so the agent does the work.',
            prompt: 'Prompt the agent',
            noComposer: 'The host has no composer to send the request to.',
            checksTitle: 'Checks',
            checkFiles: 'The finding names {count} files.',
            checkStations: 'It touches {count} stations.',
            checkReview: 'Review the folder again to confirm the finding is gone.',
            undoNote: 'Undo is not offered here: revert the branch to undo the change.',
            show: 'Show',
        },
        simulate: {
            pathTitle: 'Path to drive',
            pathEmpty: 'Pick a line or a station first; the simulation drives its path.',
            valuesLabel: 'Values to use',
            valuesPlaceholder: 'amount=100, currency=EUR',
            run: 'Ask the agent to run it',
            requestText: 'Write and run a test that drives this path: {path}. Use these values: {values}. Report each step: what was called, what it returned, and where it failed.',
            noValues: 'none given; choose sensible ones',
            sent: 'Sent to the agent. The result comes from its run; nothing is shown before.',
            noComposer: 'The host has no agent composer, so nothing can be run.',
            note: 'Simulate never fakes a run. The agent writes the test, runs it and reports each step.',
        },
        pinpoint: {
            label: 'Screenshot',
            button: 'Screenshot',
            hint: 'Paste, drop or pick a screenshot to find the code behind it.',
            reading: 'Reading the screenshot…',
            failed: 'The screenshot could not be read.',
            noMatch: 'Nothing in the code matched this screenshot.',
            thumbAlt: 'Your screenshot',
            descriptionTitle: 'What it shows',
            anchorsTitle: 'Text read from the image',
            matchesTitle: 'Where it is in the code',
            diagnose: 'Diagnose with the agent',
            diagnoseText: 'A screenshot shows: {description}. The code behind it, in order: {path}. Findings on that path: {findings}. Find out what is wrong and fix it.',
            noFindings: 'none',
            clear: 'Clear',
            dropHere: 'Drop a screenshot here',
            clearAria: 'Clear screenshot',
            notImage: 'That file is not an image.',
        },
        pinpointProvenance: { vision: 'Vision', exact: 'Exact match', catalog: 'Catalog key', import: 'Import' },
        time: {
            label: 'History',
            aria: 'History: pick a commit to mark the stations it changed',
            now: 'Now',
            commitAria: '{title}, {at}',
            changed: '{count} stations changed in this commit',
        },
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
        metrics: { ...d.metrics, ...partial.metrics },
        edgeKinds: { ...d.edgeKinds, ...partial.edgeKinds },
        packs: { ...d.packs, ...partial.packs },
        findingKinds: { ...d.findingKinds, ...partial.findingKinds },
        severity: { ...d.severity, ...partial.severity },
        fix: { ...d.fix, ...partial.fix },
        origins: { ...d.origins, ...partial.origins },
        phases: { ...d.phases, ...partial.phases },
        surface: mergeSurface(d.surface, partial.surface),
    };
}

/** The surface words over the defaults, one map deeper (its maps hold strings only). */
function mergeSurface(d: SurfaceLabels, partial?: Partial<SurfaceLabels>): SurfaceLabels {
    if (!partial) return d;
    const out: Record<string, unknown> = { ...d, ...partial };
    for (const key of Object.keys(d) as Array<keyof SurfaceLabels>) {
        const base = d[key];
        if (typeof base === 'object') out[key] = { ...base, ...(partial[key] as object | undefined) };
    }
    return out as unknown as SurfaceLabels;
}
