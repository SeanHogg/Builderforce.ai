/**
 * The host's first-load trace, as `KnowledgeGraphSource.loadTrace` answers it (the VS Code
 * extension restates it as `KnowledgeLoadTrace` in `knowledgeProtocol.ts`): the latest calls the
 * view's first paint waited on, each with its phases, and the calls still running with the phase
 * they are in now. Read by the Diagnostics' First load section and the loading screen.
 */

/** How long the host's event loop was blocked while the call ran (ms). */
export interface LoadTraceLag { maxMs: number; p99Ms: number; meanMs: number }

export interface LoadTraceEntry {
    op: string;
    rootId?: string;
    /** Epoch ms. */
    startedAt: number;
    durationMs: number;
    outcome: 'ok' | 'null' | 'error';
    error?: string;
    phases: { phase: string; ms: number }[];
    /** What answered a load (`local`, `pack`, `server`, `not-here`). */
    via?: string;
    nodes?: number;
    edges?: number;
    sources?: number;
    truncated?: boolean;
    focus?: boolean;
    maxNodes?: number;
    count?: number;
    nearDuplicates?: number;
    hostLag?: LoadTraceLag;
}

export interface LoadTraceInFlight {
    op: string;
    rootId?: string;
    startedAt: number;
    /** The phases it is in now (a load reads partitions and the index at once). */
    phases: { phase: string; startedAt: number }[];
    hostLag?: LoadTraceLag;
}

/** `now` is the host's clock, so in-flight ages are measured on the clock that stamped them. */
export interface LoadTrace { now: number; entries: LoadTraceEntry[]; inFlight: LoadTraceInFlight[] }

/** The host phases the loading screen names (`labels.loadPhases`); another phase shows as its id. */
export const LOAD_PHASES = ['partitions', 'index', 'nearDuplicates', 'build', 'pack', 'server', 'notHere'] as const;
export type LoadPhaseId = typeof LOAD_PHASES[number];
