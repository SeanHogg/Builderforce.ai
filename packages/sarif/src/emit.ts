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

export type SarifLevel = 'none' | 'note' | 'warning' | 'error';
export const SARIF_BASELINE_STATES = ['new', 'unchanged', 'updated', 'absent'] as const;
export type SarifBaselineState = (typeof SARIF_BASELINE_STATES)[number];

export type SarifPropertyBag = Record<string, unknown>;

export interface SarifMessage { text: string }

export interface SarifRegion {
  startLine?: number;
  snippet?: { text: string };
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string; uriBaseId?: string };
    region?: SarifRegion;
  };
}

export interface SarifReportingDescriptor {
  id: string;
  shortDescription?: SarifMessage;
  properties?: SarifPropertyBag;
}

export interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: SarifMessage;
  locations?: SarifLocation[];
  baselineState?: SarifBaselineState;
  partialFingerprints?: Record<string, string>;
  properties?: SarifPropertyBag;
}

export interface SarifRun {
  tool: { driver: { name: string; version?: string; informationUri?: string; rules?: SarifReportingDescriptor[] } };
  automationDetails?: { id: string };
  results: SarifResult[];
  properties?: SarifPropertyBag;
}

export interface SarifLog {
  $schema: string;
  version: typeof SARIF_VERSION;
  runs: SarifRun[];
}

/** A log of `runs`, with the schema and version every consumer checks first. */
export function sarifLog(runs: SarifRun[]): SarifLog {
  return { $schema: SARIF_SCHEMA_URI, version: SARIF_VERSION, runs };
}

/** A repository-relative location. `line` is kept only when it is a positive integer (SARIF lines are 1-based). */
export function sarifLocation(path: string, line?: number, snippet?: string): SarifLocation {
  const region: SarifRegion = {
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
