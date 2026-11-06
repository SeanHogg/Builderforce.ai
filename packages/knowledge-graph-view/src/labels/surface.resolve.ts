/** The resolve words of the surface: the interface and its English defaults (a host overrides them per key). */

export interface ResolveLabels {
    /** `{branch}`, `{count}`. */
    resolve: Record<'empty' | 'provenanceLabel' | 'checksTitle' | 'checkFiles' | 'checkStations' | 'checkReview' | 'show', string>;
    /** `{path}`, `{values}`. */
    simulate: Record<
        'pathTitle' | 'pathEmpty' | 'valuesLabel' | 'run' | 'requestText' | 'noValues' | 'sent' | 'noComposer' | 'note'
        | 'noRecorded' | 'presets' | 'presetRecorded' | 'colRecorded' | 'editAria' | 'stubsTitle' | 'stubsHint' | 'lineEnter' | 'lineCall' | 'lineReturn'
        | 'unknownResult' | 'codeTitle' | 'noVars' | 'varsTitle' | 'resultTitle' | 'noResult' | 'stubbedNote' | 'simulatedBanner' | 'saveTest' | 'saveTestText' | 'noStubs' | 'startFrom' | 'startEntry' | 'startStop',
        string
    > & { origin: Record<'recorded' | 'edited', string> };
}

export const RESOLVE_DEFAULTS: ResolveLabels = {
    resolve: {
        empty: 'Choose Resolve on a finding to work on it here.',
        provenanceLabel: 'Source',
        checksTitle: 'Checks',
        checkFiles: 'The finding names {count} files.',
        checkStations: 'It touches {count} stations.',
        checkReview: 'Review the folder again to confirm the finding is gone.',
        show: 'Show',
    },
    simulate: {
        pathTitle: 'Path to drive',
        pathEmpty: 'Pick a line or a station first; the simulation drives its path.',
        valuesLabel: 'Values to use',
        run: 'Ask the agent to run it',
        requestText: 'Write and run a test that drives this path: {path}. Use these values: {values}. Report each step: what was called, what it returned, and where it failed.',
        noValues: 'none given; choose sensible ones',
        sent: 'Sent to the agent. The result comes from its run; nothing is shown before.',
        noComposer: 'The host has no agent composer, so nothing can be run.',
        note: 'Simulate never fakes a run. The agent writes the test, runs it and reports each step.',
        noRecorded: 'The host recorded no values for this path, so there is nothing to edit. The walk still follows the hops.',
        presets: 'Argument presets',
        presetRecorded: 'Recorded',
        colRecorded: 'Recorded',
        editAria: 'Edit {name}',
        stubsTitle: 'Stubbed ports',
        stubsHint: 'A stubbed stop answers with its recorded value.',
        lineEnter: 'enter {name}',
        lineCall: 'call {name}',
        lineReturn: 'return from {name}',
        unknownResult: 'unknown: an input was edited, so only a real run can say',
        codeTitle: 'Steps in the path',
        noVars: 'No values are known at this step.',
        varsTitle: 'Variables',
        resultTitle: 'Result',
        noResult: 'No value recorded here.',
        stubbedNote: 'This stop is stubbed: it answers with its recorded value.',
        simulatedBanner: 'Simulated, not executed: this walks the hops of the path with recorded and edited values. "Ask the agent to run it" does the real run.',
        saveTest: 'Save as {file}',
        saveTestText: 'Write the test file {file} that drives this path: {path}. Use these values: {values}. Stub these ports: {stubs}. Save it in the project\'s test folder and run it.',
        noStubs: 'none',
        origin: {
            recorded: 'recorded',
            edited: 'edited',
        },
        startFrom: 'Start from',
        startEntry: 'The entry',
        startStop: 'This stop',
    },
};
