/** The coverage words of the surface: the interface and its English defaults (a host overrides them per key). */

export interface CoverageLabels {
    /** `{count}`, `{total}`; `{file}`, `{complexity}`, `{coverage}`. */
    coverage: Record<
        'notSetUpTitle' | 'notSetUpBody' | 'kpiFiles' | 'kpiFilesValue' | 'kpiMean' | 'kpiComplexity' | 'kpiRisky' | 'scatterTitle' | 'scatterAria'
        | 'axisX' | 'axisY' | 'gapsTitle' | 'gapsNone' | 'gapRow' | 'runWithValues' | 'promptTests' | 'promptText' | 'noComplexity' | 'quadrant' | 'namesMore' | 'shapeTitle' | 'shapeNone' | 'shapeAria' | 'shapeSegment' | 'unit' | 'integration' | 'e2e' | 'configTitle' | 'configNone' | 'configAll' | 'configNowhere' | 'configOnly' | 'applyV8' | 'applyV8Request',
        string
    >;
}

export const COVERAGE_DEFAULTS: CoverageLabels = {
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
        shapeTitle: 'Test shape',
        shapeNone: 'No test files in the graph, so the split is not measured.',
        shapeAria: '{unit} unit, {integration} integration, {e2e} end-to-end tests',
        shapeSegment: '{kind} {count}',
        unit: 'unit',
        integration: 'integration',
        e2e: 'e2e',
        configTitle: 'Where coverage is configured',
        configNone: 'No packages with code were found.',
        configAll: 'Coverage is configured in every package.',
        configNowhere: 'Coverage is not configured in any package.',
        configOnly: 'Coverage is configured in {packages} only. Elsewhere no coverage is measured.',
        applyV8: 'Apply: v8 coverage in {count} packages',
        applyV8Request: 'Set up v8 coverage in these {count} packages: {packages}. Add the coverage config and a script to each, run the tests with coverage on and report the new coverage.',
        quadrant: 'complex · untested',
        namesMore: '{names} +{count}',
    },
};
