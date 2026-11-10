/** The first read's words (the loading line, the host's phases, a refresh and its failure): part of `CoreLabels` (`core.ts`). */

export interface LoadLabels {
    loading: string;
    /** The loading line once it has run a second: `{elapsed}` is a span ("1 min 12 s"). */
    loadingElapsed: string;
    /** The host's step the load is in now: `{phase}` is one of `loadPhases`. */
    loadingPhase: string;
    /** Under a load that has run past ten seconds, beside Copy diagnostics. */
    loadingSlow: string;
    loadPhases: Record<'partitions' | 'index' | 'nearDuplicates' | 'build' | 'pack' | 'server' | 'notHere', string>;
    /** Shown in the scene's corner while a fresh read replaces the graph on screen. */
    refreshing: string;
    /** The fresh read failed; the last graph stays drawn and this offers Retry. */
    refreshFailed: string;
}

export const LOAD_DEFAULTS: LoadLabels = {
loading: 'Loading the knowledge graph…',
loadingElapsed: 'Loading the knowledge graph… {elapsed}',
loadingPhase: 'Now: {phase}',
loadingSlow: 'This is taking longer than usual. Copy the diagnostics to report it.',
loadPhases: {
    partitions: 'reading the project layout',
    index: 'opening the search index',
    nearDuplicates: 'finding near-duplicates',
    build: 'building the graph',
    pack: 'reading the knowledge pack',
    server: 'fetching the server’s graph',
    notHere: 'checking for a review on this machine',
},
refreshing: 'Updating…',
refreshFailed: 'Couldn’t update — showing the last graph. Retry',
};
