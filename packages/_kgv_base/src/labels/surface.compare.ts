/** The words of the compare bar (PRD 43 Part C5) and the code pane's old-version note: the interface and its English defaults (a host overrides them per key). */

export interface CompareLabels {
    compare: {
        /** The bar's group label. */
        aria: string;
        /** The source of the comparison: what the bar says is being compared. */
        sourceBaseline: string;
        sourceSnapshot: string;
        /** `{kind}` (the anti-pattern's name), `{target}` (the file). */
        sourceRestructure: string;
        /** `{sha}`, `{title}`. */
        sourceCommit: string;
        /** The Before | After group's label. */
        sideGroup: string;
        /** Play: a restructure goes Before to After, a commit comparison steps the commits oldest to newest. */
        playRestructure: string;
        playHistory: string;
        playBaseline: string;
        /** Apply on a branch (restructure only): opens the fix flow. */
        apply: string;
        applyTip: string;
        close: string;
        /** Why Before is not offered (`comparable === false`), under the bar. */
        notComparable: string;
        /** Before has nothing to show (no baseline, no earlier commit). */
        noBefore: string;
        /** The pane shows today's file because the earlier one cannot be read here. */
        oldNotAvailable: string;
        /** "See it restructured" on a Patterns card. */
        seeRestructured: string;
        /** The restructure is being prepared (the file's definitions are being read). */
        restructureLoading: string;
        /** A proposal could not be made for this finding. */
        restructureNone: string;
        /** The code pane marks (screen-reader text for the line counts). `{added}`, `{removed}`. */
        codeMarks: string;
        /** A restructure: the marked definitions leave this file for the new modules. `{modules}`. */
        movedOut: string;
    };
}

export const COMPARE_DEFAULTS: CompareLabels = {
    compare: {
        aria: 'Comparison',
        sourceBaseline: 'Compared with the last review',
        sourceSnapshot: 'Compared with the earlier snapshot',
        sourceRestructure: 'Restructure: {kind} in {target}',
        sourceCommit: 'Commit {sha}: {title}',
        sideGroup: 'Before or after',
        playRestructure: 'Play the restructure',
        playHistory: 'Replay the history',
        playBaseline: 'Play the change',
        apply: 'Apply on a branch',
        applyTip: 'Open the fix flow for this finding. Nothing changes until you apply it.',
        close: 'Stop comparing',
        notComparable: 'These two sides cannot be compared: {reasons}',
        noBefore: 'There is no earlier version to show.',
        oldNotAvailable: 'The earlier version is not available here.',
        seeRestructured: 'See it restructured',
        restructureLoading: 'Reading the file to propose a restructure…',
        restructureNone: 'No restructure can be proposed for this one.',
        codeMarks: '{added} lines added, {removed} lines removed',
        movedOut: 'The marked definitions move out to {modules}',
    },
};
