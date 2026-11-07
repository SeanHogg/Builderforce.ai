/** The sync words of the surface: the interface and its English defaults (a host overrides them per key). */

export interface SyncLabels {
    /** Why a file was skipped, by reason id (`too-large` is `tooLarge`); a reason this build has no words for shows as sent. */
    skipReasons: Record<'tooLarge' | 'unreadable' | 'rateLimited' | 'unsupported' | 'other', string>;
    /** The sync pill's state in words, read after its text (never colour alone). */
    pillStates: Record<'synced' | 'syncing' | 'error' | 'idle' | 'partial' | 'serverOnly', string>;
    sync: Record<
        'loading' | 'failed' | 'localTitle' | 'serverTitle' | 'files' | 'edges' | 'docs' | 'notUploaded' | 'pipelineTitle' | 'skippedTitle'
        | 'skippedNone' | 'skippedRow' | 'skippedRowNoSize' | 'edgesNotMeasured' | 'skippedUnknown' | 'truncatedNote' | 'sourcesTitle' | 'excludedTitle' | 'excludedNote' | 'barAria' | 'refresh' | 'deltaTitle' | 'deltaEmpty' | 'deltaSummary' | 'deltaPending' | 'deltaApplied' | 'actionSetUpV8' | 'actionTurnOn' | 'actionGenerate'  | 'setUpV8Request' | 'turnOnRequest' | 'excludedNone' | 'excludedFolder' | 'diagnosticsTitle' | 'resend' | 'resendNote' | 'deltaLoading' | 'parityTitle' | 'countPair' | 'parityAll' | 'parityMissing'
        | 'replicaTitle' | 'replicaIdle' | 'replicaSending' | 'replicaWaiting' | 'replicaWhy429' | 'replicaWhyNetwork' | 'replicaWhyServer' | 'replicaFailedRow' | 'replicaLastSync'
        | 'replicaPausedAuth' | 'replicaPausedUnreachable' | 'replicaPausedProject' | 'replicaSkippedRow'
        | 'replicaOpWrite' | 'replicaOpScope' | 'replicaOpExtracted' | 'replicaOpStale' | 'replicaOpAnalysis'
        | 'replicaReasonAuth' | 'replicaReasonBadRequest' | 'replicaReasonTooLarge' | 'replicaReasonRate' | 'replicaReasonServer' | 'replicaReasonNetwork' | 'replicaReasonOther',
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
    skipReasons: { tooLarge: 'Too large to store', unreadable: 'Could not be read', rateLimited: 'Server was busy', unsupported: 'Not a supported file', other: 'Other reason' },
    pillStates: { synced: 'Synced', syncing: 'Syncing', error: 'Error', idle: 'Not synced', partial: 'Out of sync', serverOnly: 'On the server only' },
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
        replicaTitle: 'Sending to the project',
        replicaIdle: 'Everything this machine reviewed has been sent.',
        replicaSending: 'Sending…',
        replicaWaiting: 'Waiting: {reason}. Trying again in {seconds} s.',
        replicaWhy429: 'the server is rate limiting requests',
        replicaWhyNetwork: 'the server cannot be reached',
        replicaWhyServer: 'the server answered with an error',
        replicaFailedRow: '{op}: {reason}',
        replicaLastSync: 'Last sent {time}.',
        replicaPausedAuth: 'Paused: sign in again to continue sending.',
        replicaPausedUnreachable: 'Paused: the server cannot be reached.',
        replicaPausedProject: 'Paused: this workspace is linked to another project.',
        replicaSkippedRow: '{op}: too large to store',
        replicaOpWrite: 'Facts and relations',
        replicaOpScope: 'Review summary',
        replicaOpExtracted: 'File contents',
        replicaOpStale: 'Change marker',
        replicaOpAnalysis: 'Code analysis',
        replicaReasonAuth: 'not allowed or signed out',
        replicaReasonBadRequest: 'the server refused it',
        replicaReasonTooLarge: 'too large to store',
        replicaReasonRate: 'rate limited',
        replicaReasonServer: 'server error',
        replicaReasonNetwork: 'not reachable',
        replicaReasonOther: 'unexpected error',
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
