/** The sync words of the surface: the interface and its English defaults (a host overrides them per key). */

export interface SyncLabels {
    /** The done card: `{count}` files were not stored (the list says which and why). */
    skippedUploads: string;
    /** Why a file was skipped, by reason id (`too-large` is `tooLarge`); a reason this build has no words for shows as sent. */
    skipReasons: Record<'tooLarge' | 'unreadable' | 'rateLimited' | 'unsupported' | 'other', string>;
    /** The sync pill's state in words, read after its text (never colour alone). */
    pillStates: Record<'synced' | 'syncing' | 'error' | 'idle', string>;
    sync: Record<
        'loading' | 'failed' | 'localTitle' | 'serverTitle' | 'files' | 'edges' | 'docs' | 'notUploaded' | 'pipelineTitle' | 'skippedTitle'
        | 'skippedNone' | 'skippedRow' | 'skippedRowNoSize' | 'edgesNotMeasured' | 'skippedUnknown' | 'truncatedNote' | 'sourcesTitle' | 'excludedTitle' | 'excludedNote' | 'barAria' | 'refresh' | 'deltaTitle' | 'deltaEmpty' | 'deltaSummary' | 'deltaPending' | 'deltaApplied' | 'deltaRow' | 'deltaRowAuthor' | 'actionSetUpV8' | 'actionTurnOn' | 'actionGenerate'  | 'setUpV8Request' | 'turnOnRequest' | 'excludedNone' | 'excludedFolder' | 'diagnosticsTitle' | 'resend' | 'resendNote' | 'deltaLoading' | 'parityTitle' | 'countPair' | 'parityAll' | 'parityMissing' | 'parityTooLarge',
        string
    >;
    syncSteps: Record<'walk' | 'graph' | 'upload' | 'match' | 'analyse' | 'skipped', string>;
    /** One line under each pipeline step. */
    syncStepDetails: Record<'walk' | 'graph' | 'upload' | 'match' | 'analyse' | 'skipped', string>;
    /** What a control says when this host cannot do it. `{label}`. */
    unavailable: Record<'notHere' | 'labelled', string>;
    syncStates: Record<'ok' | 'pending' | 'attention', string>;
    syncSources: Record<'code' | 'docs' | 'coverage' | 'usage' | 'traces' | 'openapi' | 'history' | 'owners', string>;
    syncExcluded: Record<'nested' | 'worktrees' | 'local' | 'vendored', string>;
    sourceStates: Record<'collected' | 'estimated' | 'absent', string>;
}

export const SYNC_DEFAULTS: SyncLabels = {
    skippedUploads: '{count} files were not stored.',
    skipReasons: { tooLarge: 'Too large to store', unreadable: 'Could not be read', rateLimited: 'Server was busy', unsupported: 'Not a supported file', other: 'Other reason' },
    pillStates: { synced: 'Synced', syncing: 'Syncing', error: 'Error', idle: 'Not synced' },
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
        deltaTitle: 'Changes since the last review',
        deltaEmpty: 'No commits to show.',
        deltaSummary: '{count} not in the picture yet',
        deltaPending: 'Pending',
        deltaApplied: 'In the picture',
        deltaRow: '{sha} · {count} files · {when}',
        deltaRowAuthor: '{sha} · {author} · {count} files · {when}',
        actionSetUpV8: 'Set up v8',
        actionTurnOn: 'Turn on',
        actionGenerate: 'Generate',
        setUpV8Request: 'Set up v8 coverage for the project: add a coverage script and config, run the tests with coverage on, and report the coverage files it writes.',
        turnOnRequest: 'Turn on runtime traces for the project: add tracing to the entry points, run it once and report where the traces are written.',
        excludedNone: 'No folder was left out.',
        excludedFolder: '{path}',
        diagnosticsTitle: 'Diagnostics',
        resend: 'Review again to retry skipped files',
        resendNote: 'Starts the whole review again for this folder. You confirm it first.',
        deltaLoading: 'Reading the commits…',
        parityTitle: '{local} / {server}',
        countPair: '{local} / {server}',
        parityAll: 'The server has all of them.',
        parityMissing: '{count} not on the server yet.',
        parityTooLarge: '{count} were too large to store.',
        refresh: 'Refresh',
    },
    syncSteps: { walk: 'Files walked', graph: 'Graph built', upload: 'Uploaded', match: 'Server matches local', analyse: 'Sources collected', skipped: 'Nothing skipped' },
    syncStepDetails: {
        walk: 'Reads the folder; ignored and excluded folders are left out.',
        graph: 'Imports, complexity and patterns for each file.',
        upload: 'Sends what changed to the server in small batches.',
        match: 'Compares file, edge and doc counts with the server.',
        analyse: 'Coverage, history, owners and OpenAPI, when present.',
        skipped: 'Files that could not be stored are listed, never dropped.',
    },
    unavailable: {
        notHere: 'Not available here',
        labelled: '{label}: not available here',
    },
    syncStates: { ok: 'Done', pending: 'Waiting', attention: 'Needs attention' },
    syncSources: { code: 'Code', docs: 'Documents', coverage: 'Coverage', usage: 'Usage', traces: 'Traces', openapi: 'OpenAPI', history: 'History', owners: 'Owners' },
    syncExcluded: { nested: 'Nested git checkouts', worktrees: '.worktrees folders', local: '*.local folders', vendored: 'Vendored _*_src folders' },
    sourceStates: { collected: 'Collected', estimated: 'Estimated', absent: 'Not set up' },
};
