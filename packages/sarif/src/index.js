/**
 * `@builderforce/sarif` — THE SARIF 2.1.0 interchange (PRD 41 §C12): parse (moved from the api's
 * `scanReportParsers`) and emit. Pure and dependency-free.
 */
export { FINDING_SEVERITIES, normalizeSeverity, toNormalizedFinding, } from './finding.js';
export { readSarifResults, sarifToFindings } from './parse.js';
export { ANCHOR_FINGERPRINT, SARIF_BASELINE_STATES, SARIF_SCHEMA_URI, SARIF_VERSION, SRCROOT, sarifLocation, sarifLog, } from './emit.js';
//# sourceMappingURL=index.js.map