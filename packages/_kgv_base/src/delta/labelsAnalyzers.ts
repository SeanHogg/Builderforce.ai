/**
 * The English defaults of the run delta's L3 analyzer words (PRD 41 §B7): the reasons an analyzer run did not measure,
 * its finding kinds, its metric and its finding params. Split out of `labels.ts` and spread into
 * `DEFAULT_RUN_DELTA_LABELS`, so the public label object is unchanged; the `runDelta.*` catalogs mirror these keys.
 */

/** `reasons.*`: a tool's run (`MeasuredBy.reason`) and the analyzer reason families (`<prefix>:<tool>`, `{tool}`). */
export const ANALYZER_REASON_LABELS = {
    analyzerNotMeasured: '{tool} not measured',
    analyzerPending: '{tool} still measuring',
    analyzerDataStale: '{tool} data is out of date',
    toolAbsent: 'Tool not installed',
    analyzerUnavailable: 'Bundled analyzer could not start',
    timeout: 'Timed out',
    exitFailed: 'The tool exited with an error',
    invalidReport: 'Unreadable tool report',
    noCoverage: 'No coverage report for the changed lines',
    beforeTreeUnavailable: 'The before version of the tree could not be built',
    analyzerThrew: 'The analyzer stopped with an error',
    noAnalyzerHost: 'This editor does not run the analyzers',
    untrustedWorkspace: 'Not run in an untrusted workspace',
    outputTooLarge: 'The tool printed too much output',
    noDatabase: 'No offline vulnerability database yet',
    noConfig: 'The repository has no rules for this tool',
    interrupted: 'Stopped when the editor closed before it finished',
} as const;

/** `rules.*`: the analyzer finding kinds (run-delta `ANALYZER_RULES`). */
export const ANALYZER_RULE_LABELS = {
    vulnerableDependency: 'Dependency with a known vulnerability',
    secretLeak: 'Secret found by the secret scanner',
    dependencyCycle: 'Module dependency cycle',
    forbiddenDependency: 'Forbidden dependency',
    typeError: 'Type error',
    semgrepFinding: 'Semgrep finding',
    codeqlFinding: 'CodeQL finding',
} as const;

/** `metrics.*`. */
export const ANALYZER_METRIC_LABELS = {
    coverageDiff: 'Changed-line coverage',
} as const;

/** `params.*`: the analyzers' finding params. */
export const ANALYZER_PARAM_LABELS = {
    package: 'Package',
    version: 'Version',
    advisory: 'Advisory',
    ecosystem: 'Ecosystem',
    rule: 'Rule',
    code: 'Code',
    sarifRule: 'Scanner rule',
    tool: 'Scanner',
    cwe: 'Weakness (CWE)',
} as const;
