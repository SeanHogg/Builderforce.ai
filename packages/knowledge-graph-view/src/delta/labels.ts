/**
 * Every word the run delta card and panel show (PRD 41 §C11), as ONE typed object with English
 * defaults. The engine (`@builderforce/run-delta`) emits codes and counts only; each code maps
 * to a key here through {@link labelKey} (`guard-removed` → `rules.guardRemoved`,
 * `ilities.functional-suitability` → `dimensions.ilitiesFunctionalSuitability`,
 * `tool-missing:knip` → `reasons.toolMissing` with `{tool}`).
 *
 * Hosts pass their `runDelta.*` catalog through {@link runDeltaLabels} (the view's ONE walker),
 * so the catalog mirrors this object key for key. Templates use `{name}` placeholders and
 * `[[optional]]` parts, filled by `fillTemplate`, never by the host's i18n runtime.
 */

import { labelsFromCatalog } from '../catalogLabels';

export const RUN_DELTA_NAMESPACE = 'runDelta';

export interface RunDeltaLabels {
    cardTitle: string;
    openDetails: string;
    openCode: string;
    close: string;
    panelTitle: string;
    /** Shown beside a `heuristic` finding or reason: the ≈ mark and what it means. */
    heuristicMark: string;
    heuristicHint: string;
    /** `{count}` introduced / resolved / changed in one dimension row. */
    introducedCount: string;
    resolvedCount: string;
    changedCount: string;
    blastRadius: string;
    /** `{band}`, e.g. "Blast radius: high". */
    blastRadiusValue: string;
    blocking: string;
    noFindings: string;
    findingsHeading: string;
    metricsHeading: string;
    evidenceHeading: string;
    paramsHeading: string;
    /** Files whose before side could not be read: analyzed on the after side only (lineage `present`). */
    unresolvedHeading: string;
    excludedHeading: string;
    /** `{count}` hits folded into one finding (`params.aggregated`). */
    aggregated: string;
    blockingHeading: string;
    failedHeading: string;
    /** `{before}` → `{after}` `{unit}` (a missing side reads {@link notMeasuredValue}). */
    metricValue: string;
    notMeasuredValue: string;
    waived: string;
    sideBefore: string;
    sideAfter: string;
    /** Headline sentence parts (C10), joined in the catalog's own order. */
    headline: {
        sentence: string;
        sentenceNoClauses: string;
        clause: string;
        detail: string;
        clauseSeparator: string;
        listSeparator: string;
        unchanged: string;
        notMeasured: string;
        metricRegressed: string;
    };
    verdicts: { better: string; worse: string; same: string; notComparable: string; notMeasured: string };
    dimensions: {
        security: string;
        performance: string;
        quality: string;
        ilitiesFunctionalSuitability: string;
        ilitiesCompatibility: string;
        ilitiesInteractionCapability: string;
        ilitiesReliability: string;
        ilitiesMaintainability: string;
        ilitiesFlexibility: string;
        ilitiesSafety: string;
    };
    severities: { info: string; warn: string; error: string };
    lineages: { introduced: string; resolved: string; changed: string; persisting: string; present: string };
    changes: { grew: string; shrank: string; moved: string };
    bands: { low: string; medium: string; high: string };
    /** Reason codes on a dimension, the blast radius or an analyzer run. `{tool}` for the prefixed ones. */
    reasons: Record<string, string>;
    /** Headline clause codes that are neither a rule id nor a reason. */
    clauses: { findingsResolved: string; metricsImproved: string; worse: string };
    /** One per engine rule id. */
    rules: Record<string, string>;
    metrics: Record<string, string>;
    units: Record<string, string>;
    /** `UnresolvedFile.reason`. */
    excluded: Record<string, string>;
    /** A finding param's name; a key with no entry is shown as the key. */
    params: Record<string, string>;
    /** Coded param values by param name (`via`, `change`, `kind`, `crossed`); any other value is data, shown as is. */
    paramValues: Record<string, Record<string, string>>;
    /** `unsafe-regex:<key>.<reason>` reasons. */
    unsafeReasons: Record<string, string>;
}

export const DEFAULT_RUN_DELTA_LABELS: RunDeltaLabels = {
    cardTitle: 'Run delta',
    openDetails: 'Open details',
    openCode: 'Open code',
    close: 'Close',
    panelTitle: 'What this run changed',
    heuristicMark: '≈',
    heuristicHint: 'Estimated by a heuristic, not measured exactly',
    introducedCount: '{count} new',
    resolvedCount: '{count} resolved',
    changedCount: '{count} changed',
    blastRadius: 'Blast radius',
    blastRadiusValue: 'Blast radius: {band}',
    blocking: 'Blocks finalizing an autonomous run',
    noFindings: 'No findings',
    findingsHeading: 'Findings',
    metricsHeading: 'Metrics',
    evidenceHeading: 'Evidence',
    paramsHeading: 'Details',
    unresolvedHeading: 'Files without a before side',
    excludedHeading: 'Excluded files',
    aggregated: 'aggregated ({count})',
    blockingHeading: 'What blocks an autonomous run',
    failedHeading: 'Checks that did not run',
    metricValue: '{before} → {after}[[ {unit}]]',
    notMeasuredValue: 'not measured',
    waived: 'Risk accepted: {reason}',
    sideBefore: 'Before',
    sideAfter: 'After',
    headline: {
        sentence: '{lead}: {clauses}.',
        sentenceNoClauses: '{lead}.',
        clause: '{dimension} ({detail})',
        detail: '[[{count} × ]]{label}',
        clauseSeparator: '; ',
        listSeparator: ', ',
        unchanged: 'Unchanged: {dimensions}.',
        notMeasured: 'Not measured: {dimensions}.',
        metricRegressed: '{metric} regressed',
    },
    verdicts: { better: 'Better', worse: 'Worse', same: 'Unchanged', notComparable: 'Not comparable', notMeasured: 'Not measured' },
    dimensions: {
        security: 'Security',
        performance: 'Performance',
        quality: 'Quality',
        ilitiesFunctionalSuitability: 'Functional suitability',
        ilitiesCompatibility: 'Compatibility',
        ilitiesInteractionCapability: 'Interaction capability',
        ilitiesReliability: 'Reliability',
        ilitiesMaintainability: 'Maintainability',
        ilitiesFlexibility: 'Flexibility',
        ilitiesSafety: 'Safety',
    },
    severities: { info: 'Info', warn: 'Warning', error: 'Error' },
    lineages: { introduced: 'New in this run', resolved: 'Resolved by this run', changed: 'Changed by this run', persisting: 'Already there', present: 'Present now' },
    changes: { grew: 'grew', shrank: 'shrank', moved: 'moved' },
    bands: { low: 'low', medium: 'medium', high: 'high' },
    reasons: {
        staticOnly: 'Static only',
        ruleNotBuilt: 'Rule not built yet',
        ruleFailed: 'A check failed',
        ruleThrew: 'The check stopped with an error',
        metricNotMeasured: 'A metric was not measured',
        testsWeakened: 'Tests weakened',
        heuristic: 'Heuristic',
        notComparable: 'Not comparable',
        beforeUnresolved: 'Some before files could not be read',
        headSwitched: 'The branch changed during the run',
        extractorMismatch: 'Different extractor on each side',
        extractorVersionChanged: 'Extractor version changed',
        contentHashRuleChanged: 'Content hash rule changed',
        toolMissing: '{tool} missing on one side',
        toolVersionChanged: '{tool} version changed',
        analyzerFailed: '{tool} failed',
        scopeChanged: 'Scope changed',
        repoChanged: 'Repository changed',
        branchChanged: 'Branch changed',
        truncated: 'Results were truncated',
        insufficientHistory: 'Not enough past runs to rank',
        notComparableRule: '{rule} could not be certified',
        unsafeRegex: '{key}: unsafe pattern dropped ({reason})',
    },
    clauses: { findingsResolved: 'findings resolved', metricsImproved: 'metrics improved', worse: 'got worse' },
    rules: {
        guardRemoved: 'Route lost its auth guard',
        guardWeakened: 'Route guard weakened',
        entryAdded: 'New entry point',
        entryRemoved: 'Entry point removed',
        capabilityAdded: 'New system capability',
        weakCrypto: 'Weak cryptography',
        secretAdded: 'Secret added to code',
        ioInLoop: 'I/O inside a loop',
        syncIo: 'Blocking I/O call',
        testDeleted: 'Test deleted',
        testSkipped: 'Test skipped',
        onlyAdded: 'Focused test (.only) added',
        assertionsReduced: 'Fewer assertions',
        matcherWeakened: 'Weaker assertion matcher',
        suppressionAdded: 'Lint or type check suppressed',
        timeoutRaised: 'Test timeout raised',
        snapshotUpdatedWithImpl: 'Snapshot updated with the code',
        assertionEditedWithImpl: 'Assertion edited with the code',
        apiBreaking: 'Breaking API change',
        apiAdded: 'New public API',
        cloneGroup: 'Duplicated code',
        cycle: 'Dependency cycle',
        godModule: 'Oversized module',
        partitionViolation: 'Partition boundary crossed',
        unusedDependency: 'Unused dependency',
        unusedExport: 'Unused export',
        unusedFile: 'Unused file',
        godFileGrowth: 'Oversized file grew',
        destructiveDdl: 'Destructive schema change',
        forcePush: 'Force push in a script',
        rmRf: 'Recursive delete in a script',
        deltaConfigChanged: 'Delta policy file changed',
    },
    metrics: {
        complexityMax: 'Highest complexity',
        complexitySum: 'Total complexity',
        todoAdded: 'TODOs added',
        anyCastAdded: '"any" casts added',
    },
    /** A unit with no entry (`count`) is shown bare. */
    units: { cyclomatic: 'cyclomatic' },
    excluded: {
        preimageTooLarge: 'Before version too large to keep',
        preimageMissing: 'Before version missing',
        gitUnavailable: 'Git unavailable',
        changedIgnored: 'Ignored file',
        changedOutsideRun: 'Changed outside this run',
        submoduleMoved: 'Submodule moved',
        binary: 'Binary file',
    },
    params: {
        route: 'Route',
        guard: 'Guard',
        via: 'Detected by',
        file: 'File',
        from: 'Previously',
        replacement: 'Replaced by',
        kind: 'Kind',
        guards: 'Guards',
        symbol: 'Symbol',
        change: 'Change',
        before: 'Before',
        after: 'After',
        crossed: 'Crossed the size limit',
        test: 'Test',
        assertions: 'Assertions',
        to: 'Now',
        loop: 'Loop',
        call: 'Call',
        key: 'Match',
        count: 'Count',
        members: 'Members',
    },
    paramValues: {
        via: { chain: 'Handler chain', middleware: 'Middleware', rekeyed: 'Route renamed', unguardedSibling: 'Unguarded among guarded siblings' },
        change: { added: 'Added', edited: 'Edited', deleted: 'Deleted', removed: 'Removed', changed: 'Changed' },
        kind: { httpRoute: 'HTTP route', middleware: 'Middleware', vscodeCommand: 'VS Code command', webviewMessage: 'Webview message' },
        crossed: { '0': 'No', '1': 'Yes' },
    },
    unsafeReasons: {
        tooLong: 'too long',
        invalid: 'invalid',
        backreference: 'backreference',
        nestedQuantifier: 'nested quantifier',
        quantifiedAlternation: 'quantified alternation',
    },
};

/** A stable code → its label key: `guard-removed` → `guardRemoved`, `complexity.max` → `complexityMax`, `not_comparable` → `notComparable`. */
export function labelKey(code: string): string {
    return code.replace(/[._]/g, '-').replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** The host's `runDelta.*` catalog → labels; a missing key keeps its English default. */
export function runDeltaLabels(raw: (key: string) => unknown): RunDeltaLabels {
    return labelsFromCatalog(DEFAULT_RUN_DELTA_LABELS, RUN_DELTA_NAMESPACE, raw);
}
