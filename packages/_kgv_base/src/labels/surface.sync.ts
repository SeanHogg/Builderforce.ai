/** The sync words of the surface (what the Reviews panel's Server tab says): the interface and its English defaults (a host overrides them per key). */

export interface SyncLabels {
    /** Why a file was skipped, by reason id (`too-large` is `tooLarge`); a reason this build has no words for shows as sent. */
    skipReasons: Record<'tooLarge' | 'unreadable' | 'rateLimited' | 'unsupported' | 'other', string>;
    /** The status chip's state in words, read after its text (never colour alone). */
    pillStates: Record<'synced' | 'syncing' | 'error' | 'idle' | 'partial' | 'serverOnly', string>;
    sync: Record<
        'skippedRow' | 'skippedRowNoSize' | 'skippedUnknown' | 'sourcesTitle' | 'excludedTitle' | 'excludedNote' | 'excludedNone' | 'excludedFolder'
        | 'deltaTitle' | 'deltaEmpty' | 'deltaSummary' | 'deltaPending' | 'deltaApplied' | 'deltaLoading'
        | 'actionSetUpV8' | 'actionTurnOn' | 'actionGenerate' | 'setUpV8Request' | 'turnOnRequest' | 'resend' | 'resendNote'
        | 'replicaTitle' | 'replicaIdle' | 'replicaSending' | 'replicaWaiting' | 'replicaWhy429' | 'replicaWhyNetwork' | 'replicaWhyServer' | 'replicaFailedRow' | 'replicaLastSync' | 'replicaPack' | 'replicaParts' | 'replicaUnitB' | 'replicaUnitKB' | 'replicaUnitMB'
        | 'replicaPausedAuth' | 'replicaPausedUnreachable' | 'replicaPausedProject'
        | 'replicaReasonAuth' | 'replicaReasonBadRequest' | 'replicaReasonTooLarge' | 'replicaReasonRate' | 'replicaReasonServer' | 'replicaReasonNetwork' | 'replicaReasonOther',
        string
    >;
    /** What a control says when this host cannot do it. `{label}`. */
    unavailable: Record<'notHere' | 'labelled', string>;
    syncSources: Record<'code' | 'docs' | 'coverage' | 'usage' | 'traces' | 'openapi' | 'history' | 'owners', string>;
    syncExcluded: Record<'nested' | 'worktrees' | 'local' | 'vendored', string>;
    sourceStates: Record<'collected' | 'estimated' | 'absent', string>;
}

export const SYNC_DEFAULTS: SyncLabels = {
    skipReasons: { tooLarge: 'Too large to store', unreadable: 'Could not be read', rateLimited: 'Server was busy', unsupported: 'Not a supported file', other: 'Other reason' },
    pillStates: { synced: 'Synced', syncing: 'Syncing', error: 'Error', idle: 'Not synced', partial: 'Out of sync', serverOnly: 'On the server only' },
    sync: {
        skippedRow: '{path} · {size} · {reason}',
        skippedRowNoSize: '{path} · {reason}',
        skippedUnknown: 'Unknown: no review recorded what it skipped.',
        sourcesTitle: 'Data sources',
        excludedTitle: 'Excluded folders',
        excludedNote: 'These folders are never read.',
        excludedNone: 'No folder was left out.',
        excludedFolder: '{path}',
        deltaTitle: 'Changes since the last review',
        deltaEmpty: 'No commits to show.',
        deltaSummary: '{count} not in the picture yet',
        deltaPending: 'Pending',
        deltaApplied: 'In the picture',
        deltaLoading: 'Reading the commits…',
        actionSetUpV8: 'Set up v8',
        actionTurnOn: 'Turn on',
        actionGenerate: 'Generate',
        setUpV8Request: 'Set up v8 coverage for the project: add a coverage script and config, run the tests with coverage on, and report the coverage files it writes.',
        turnOnRequest: 'Turn on runtime traces for the project: add tracing to the entry points, run it once and report where the traces are written.',
        resend: 'Review again to retry skipped files',
        resendNote: 'Starts the whole review again for this folder. You confirm it first.',
        replicaTitle: 'Sending to the project',
        replicaIdle: 'Everything this machine reviewed has been sent.',
        replicaSending: 'Sending…',
        replicaWaiting: 'Waiting: {reason}. Trying again in {seconds} s.',
        replicaWhy429: 'the server is rate limiting requests',
        replicaWhyNetwork: 'the server cannot be reached',
        replicaWhyServer: 'the server answered with an error',
        replicaFailedRow: '{reason}',
        replicaLastSync: 'Last sent {time}.',
        /** {size} compressed, {percent} of the same rows as JSON, {files}. */
        replicaPack: 'Last pack: {size}, {percent}% of its JSON size ({files} files).',
        /** {sent} of {total} parts the server has, {left} still to send. */
        replicaParts: 'Sending part {sent} of {total} ({left} left).',
        /** A byte size, `{value}` already formatted for the reader's locale. */
        replicaUnitB: '{value} B',
        replicaUnitKB: '{value} KB',
        replicaUnitMB: '{value} MB',
        replicaPausedAuth: 'Paused: sign in again to continue sending.',
        replicaPausedUnreachable: 'Paused: the server cannot be reached.',
        replicaPausedProject: 'Paused: this workspace is linked to another project.',
        replicaReasonAuth: 'not allowed or signed out',
        replicaReasonBadRequest: 'the server refused it',
        replicaReasonTooLarge: 'too large to store',
        replicaReasonRate: 'rate limited',
        replicaReasonServer: 'server error',
        replicaReasonNetwork: 'not reachable',
        replicaReasonOther: 'unexpected error',
    },
    unavailable: {
        notHere: 'Not available here',
        labelled: '{label}: not available here',
    },
    syncSources: { code: 'Code', docs: 'Documents', coverage: 'Coverage', usage: 'Usage', traces: 'Traces', openapi: 'OpenAPI', history: 'History', owners: 'Owners' },
    syncExcluded: { nested: 'Nested git checkouts', worktrees: '.worktrees folders', local: '*.local folders', vendored: 'Vendored _*_src folders' },
    sourceStates: { collected: 'Collected', estimated: 'Estimated', absent: 'Not set up' },
};
