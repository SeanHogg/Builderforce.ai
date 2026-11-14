/**
 * SARIF 2.1.0 export — the typed subset of the OASIS format the platform writes, and the builders that
 * keep every log it emits valid against the official schema (vendored at `schema/sarif-schema-2.1.0.json`
 * and asserted in the exporters' tests). Pure: the caller supplies every value, ordering included.
 */
export const SARIF_VERSION = '2.1.0';
export const SARIF_SCHEMA_URI = 'https://json.schemastore.org/sarif-2.1.0.json';
/**
 * The `partialFingerprints` key a finding's stable identity anchor is written under (PRD 41 §C3/§C12).
 * A SARIF consumer (GitHub code scanning) matches results across runs by it.
 */
export const ANCHOR_FINGERPRINT = 'anchor/v1';
/** The `uriBaseId` artifact paths are relative to: the repository root. */
export const SRCROOT = '%SRCROOT%';
export const SARIF_BASELINE_STATES = ['new', 'unchanged', 'updated', 'absent'];
/** A log of `runs`, with the schema and version every consumer checks first. */
export function sarifLog(runs) {
    return { $schema: SARIF_SCHEMA_URI, version: SARIF_VERSION, runs };
}
/** A repository-relative location. `line` is kept only when it is a positive integer (SARIF lines are 1-based). */
export function sarifLocation(path, line, snippet) {
    const region = {
        ...(line !== undefined && Number.isInteger(line) && line > 0 ? { startLine: line } : {}),
        ...(snippet ? { snippet: { text: snippet } } : {}),
    };
    return {
        physicalLocation: {
            artifactLocation: { uri: path, uriBaseId: SRCROOT },
            ...(Object.keys(region).length > 0 ? { region } : {}),
        },
    };
}
//# sourceMappingURL=emit.js.map