/**
 * The DATA-ARCHITECTURE objects, declared once.
 *
 * ── WHY A SPEC RATHER THAN SIX MORE REGISTRY ROWS ────────────────────────────
 * `creationObjectRegistry` carries each kind's label, icon and blank shape inline,
 * and then repeats every one of their field lists in `MUTABLE_FIELDS` and a third
 * time in `CONTEXT_FIELDS`. That triple entry is exactly what let a `kpi` be
 * authored with a `value` the AI context then stripped, and it is the reason the
 * seventeen founder kinds are derived from `founderObjects.ts` instead.
 *
 * These six follow that precedent for the same reason, plus one of their own: the
 * fields ARE the contract. An `erd` whose `dataModel` is authorable but absent
 * from the AI context is an ERD Brain can write and then cannot read — so "add an
 * invoices table to that model" silently replaces the diagram instead of amending
 * it. Declaring the fields once makes that class of drift impossible.
 *
 * ── THE AUTHORED / DERIVED SPLIT ─────────────────────────────────────────────
 * `mutable` is what Brain MAY write. `derived` is what a generator writes and
 * Brain may only READ: `ddl` and `mermaid` are renderings of `dataModel`, and
 * `issues` is the validator's verdict on it. An authored DDL that disagreed with
 * its own diagram is precisely the drift this split prevents.
 */

import type { CreationNodeData, CreationObjectKind } from '@/components/creation-canvas/types';

/** The six kinds this module owns, named so the registry can PROVE it covered them all
 *  rather than spreading an index-signature map that satisfies any key at all. */
export type DataArchitectureKind = Extract<CreationObjectKind, 'datasource' | 'erd' | 'dataContract' | 'dataQuality' | 'metric' | 'lineage'>;

export interface DataArchitectureSpec {
  kind: DataArchitectureKind;
  /** English fallback the palette shows before its i18n key resolves, matching
   *  how the inline registry entries read. Localized via `creationCanvas.object.*`. */
  label: string;
  icon: string;
  /** Blank-object status, as the English fallback. */
  status: string;
  /** Extra blank-object fields, so an empty card renders its own empty state
   *  rather than the generic "object ready" fallback. */
  seed?: Record<string, unknown>;
  actions: readonly string[];
  /** Fields Brain may author. `content` is added by the registry for every kind. */
  mutable: readonly string[];
  /** Fields a generator writes and Brain may only read. */
  derived?: readonly string[];
}

export const DATA_ARCHITECTURE_SPECS: readonly DataArchitectureSpec[] = [
  {
    // A `dataset` is a SNAPSHOT; this re-reads. `connectionId` binds it to a real
    // integration credential and is set by the connect flow, never asserted by a
    // patch — the same rule `resourceId` follows.
    kind: 'datasource',
    label: 'Data source',
    icon: '◎',
    status: 'Choose a connection',
    seed: { tables: [], sql: '' },
    actions: ['connect', 'introspect', 'query', 'refresh'],
    mutable: ['sql', 'tables', 'relationships', 'scanned', 'summary', 'columns', 'rows', 'rowCount', 'sampleRows', 'fetchedAt', 'lineage', 'producedAt'],
    derived: ['connectionId', 'provider', 'providerLabel'],
  },
  {
    kind: 'erd',
    label: 'Data model (ERD)',
    icon: '⬡',
    status: 'Empty model',
    seed: { dialect: 'postgres', dataModel: { entities: [], relationships: [] } },
    actions: ['validate', 'ddl', 'export', 'introspect'],
    mutable: ['dataModel', 'dialect', 'notes', 'summary', 'sources', 'sourceObjectId'],
    derived: ['ddl', 'mermaid', 'issues'],
  },
  {
    kind: 'dataContract',
    label: 'Data contract',
    icon: '⌗',
    status: 'Not declared',
    seed: { dataContract: { columns: [] }, violations: [] },
    actions: ['infer', 'evaluate'],
    mutable: ['dataContract', 'violations', 'verdict', 'summary', 'sourceDatasetId', 'fetchedAt'],
  },
  {
    kind: 'dataQuality',
    label: 'Data quality',
    icon: '✓',
    status: 'Not run',
    seed: { checks: [], results: [] },
    actions: ['run', 'suggest'],
    mutable: ['checks', 'results', 'verdict', 'score', 'summary', 'sourceDatasetId', 'lastRunAt'],
  },
  {
    // The DEFINITION of a number — not a reading of one. `liveMetric` is the
    // reading; see the split argued in the contract's founder block.
    // `value`/`series` are the last evaluation, written by the compute action, so
    // a definition and the number it produced cannot disagree about the formula.
    kind: 'metric',
    label: 'Metric definition',
    icon: '∑',
    status: 'Not defined',
    seed: { definition: null },
    actions: ['define', 'compute', 'chart'],
    mutable: ['definition', 'sourceObjectId', 'value', 'series', 'summary', 'fetchedAt', 'lineage', 'producedAt'],
  },
  {
    kind: 'lineage',
    label: 'Lineage',
    icon: '≈',
    status: 'Nothing traced',
    seed: { lineageNodes: [], lineageEdges: [] },
    actions: ['trace', 'refresh'],
    mutable: ['lineageNodes', 'lineageEdges', 'staleDerivatives', 'summary', 'focusObjectId'],
  },
];

const BY_KIND = new Map(DATA_ARCHITECTURE_SPECS.map((spec) => [spec.kind, spec]));

/** Blank object for one data-architecture kind. */
export function dataArchitectureSeed(spec: DataArchitectureSpec): CreationNodeData {
  return { kind: spec.kind, title: spec.label, status: spec.status, ...(spec.seed ?? {}) } as CreationNodeData;
}

/** The authorable fields for one kind, in declaration order. */
export function dataArchitectureMutableFields(kind: DataArchitectureSpec['kind']): readonly string[] {
  const spec = BY_KIND.get(kind);
  return spec ? ['content', ...spec.mutable] : ['content'];
}

/**
 * Every field name these kinds carry, authored or derived.
 *
 * Folded into the registry's AI-context list so Brain can READ a model, a
 * verdict, a contract and a lineage graph it did not author this turn — which is
 * the difference between amending what is on the board and replacing it.
 */
export const DATA_ARCHITECTURE_FIELD_NAMES: readonly string[] = [
  ...new Set(DATA_ARCHITECTURE_SPECS.flatMap((spec) => [...spec.mutable, ...(spec.derived ?? [])])),
];
