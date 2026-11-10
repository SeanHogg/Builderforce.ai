/**
 * The words of the run delta HISTORY and TREND (PRD 41 §C11.3), as one typed object with English
 * defaults. The catalog lives under `runDelta.history.*` (the same `runDelta` namespace the card
 * reads, so every host that ships the card's catalog ships these too) and goes through the view's
 * ONE catalog walker. Verdicts, dimensions and bands are the card's own words ({@link RunDeltaLabels}).
 */

import { labelsFromCatalog } from '../../catalogLabels';

export const RUN_DELTA_HISTORY_NAMESPACE = 'runDelta.history';

export interface RunDeltaHistoryLabels {
    title: string;
    listHeading: string;
    trendHeading: string;
    /** The verdict matrix: one row per dimension, one column per run. */
    verdictTrend: string;
    blastTrend: string;
    /** `{runs}`, `{worse}`, `{better}`: the matrix's accessible summary. */
    trendSummary: string;
    /** `{score}`, `{band}`, `{min}`, `{max}`: the blast-radius line's accessible summary. */
    blastSummary: string;
    /** `{dimension}`, `{verdict}`, `{time}`: one matrix cell's tooltip. */
    cellTitle: string;
    /** `{score}`, `{band}`, `{time}`: one point of the blast-radius line. */
    pointTitle: string;
    tooFewRuns: string;
    empty: string;
    loading: string;
    loadError: string;
    /** A run's delta could not be opened from its history row. */
    openError: string;
    retry: string;
    loadMore: string;
    /** `{introduced}` new, `{resolved}` resolved, across the run's dimensions. */
    counts: string;
    blocked: string;
    /** `{time}`: a row's accessible name when it opens the run's delta. */
    openRun: string;
    surfaces: { vscode: string; cloud: string; web: string };
}

export const DEFAULT_RUN_DELTA_HISTORY_LABELS: RunDeltaHistoryLabels = {
    title: 'Run deltas',
    listHeading: 'Recent runs',
    trendHeading: 'Trend',
    verdictTrend: 'Verdict by dimension, oldest run first',
    blastTrend: 'Blast radius score per run',
    trendSummary: '{runs} runs: {worse} worse, {better} better',
    blastSummary: 'Latest blast radius score {score} ({band}); range {min} to {max}',
    cellTitle: '{dimension}: {verdict} ({time})',
    pointTitle: 'Blast radius score {score}, {band} ({time})',
    tooFewRuns: 'The trend appears after two runs.',
    empty: 'No run deltas yet. One is recorded each time an agent run finishes.',
    loading: 'Loading run deltas…',
    loadError: 'Run deltas could not be loaded.',
    openError: 'This run delta could not be opened.',
    retry: 'Try again',
    loadMore: 'Show older runs',
    counts: '{introduced} new · {resolved} resolved',
    blocked: 'Blocked',
    openRun: 'Open the run delta from {time}',
    surfaces: { vscode: 'In the editor', cloud: 'In the cloud', web: 'In the browser' },
};

/** The host's `runDelta.history.*` catalog → labels; a missing key keeps its English default. */
export function runDeltaHistoryLabels(raw: (key: string) => unknown): RunDeltaHistoryLabels {
    return labelsFromCatalog(DEFAULT_RUN_DELTA_HISTORY_LABELS, RUN_DELTA_HISTORY_NAMESPACE, raw);
}
