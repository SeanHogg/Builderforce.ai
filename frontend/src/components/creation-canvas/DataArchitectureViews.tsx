'use client';

/**
 * Node bodies for the data-architecture objects.
 *
 * Six cards, one file, because they share a visual language and a set of
 * conventions that would drift if they were scattered: a verdict strip leads
 * every one, evidence follows, and nothing renders a pre-built English sentence
 * — every result is a `rule`/`kind` plus a `detail` map that is interpolated
 * into a localized string here.
 *
 * They are deliberately NOT in CreationNode.tsx: that file is already the widest
 * dispatch in the codebase, and an ERD needs a layout pass, an SVG underlay and
 * a scroll container that have nothing to do with the other eighty kinds.
 *
 * Colour comes from the canvas palette (`--canvas-*`) and the shared tone tokens
 * (`--tone-*-bg`/`-ink`/`-mark`), which the board declares for BOTH themes — so
 * these read correctly in light and dark without a single literal here.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import type { CreationNodeData } from './types';
import {
  dataModelLayout,
  dataModelSummary,
  entityKey,
  readDataModel,
  validateDataModel,
  type DataModelIssue,
} from '@/lib/canvasDataModel';
import { normalizeDataContract, type ContractViolation } from '@/lib/canvasDataGovernance';
import { dataQualityVerdict, type DataQualityResult } from '@/lib/canvasDataQuality';
import { normalizeMetricDefinition, formatMetricValue } from '@/lib/canvasMetrics';
import { useFormat } from "@/i18n/useFormat";

/** Shared verdict strip. One component so a red ERD, a red contract, a red quality
 *  suite and a red test run cannot look like four different severities of the same
 *  thing — which is why it is exported rather than copied into `QaObjectViews`. */
export function VerdictStrip({ tone, headline, detail }: { tone: 'success' | 'warning' | 'danger' | 'info'; headline: string; detail?: string }) {
  return (
    <div className={styles.dataVerdict} data-tone={tone}>
      <strong>{headline}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Render an evidence map as localized `label: value` pairs.
 *
 * Interpolating the map into a per-rule sentence is what a first attempt reaches
 * for, and it is wrong: the keys VARY by rule — an out-of-range violation may
 * carry `min`, or `max`, or both — so any message naming all of them breaks on
 * the case that carries fewer. The rule gets a parameter-free sentence and the
 * evidence is rendered here, which localizes cleanly in five languages and
 * cannot throw on a shape nobody anticipated.
 */
function useDetailFormatter() {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas.node');
  return (detail: Record<string, string | number> | undefined): string => {
    if (!detail) return '';
    return Object.entries(detail)
      .filter(([, value]) => value !== '' && value != null)
      .slice(0, 5)
      .map(([key, value]) => {
        const label = t.has(`detailKey_${key}`) ? t(`detailKey_${key}`) : key;
        return `${label}: ${typeof value === 'number' ? fmt.number(value) : value}`;
      })
      .join(' · ');
  };
}

// ---------------------------------------------------------------------------
// ERD
// ---------------------------------------------------------------------------

/**
 * The entity-relationship diagram.
 *
 * Entity cards are positioned HTML (so attribute rows stay selectable text and
 * scale with the reader's font size) over an SVG underlay carrying the
 * relationship lines and their crow's-foot notation.
 */
export function ErdBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const model = useMemo(() => readDataModel(data as Record<string, unknown>), [data]);
  const issues = useMemo(() => validateDataModel(model), [model]);
  const summary = useMemo(() => dataModelSummary(model, issues), [model, issues]);
  const layout = useMemo(() => dataModelLayout(model), [model]);

  if (!model.entities.length) {
    return <div className={styles.dataEmpty}>
      <strong>{t('erdEmptyTitle')}</strong>
      <span>{t('erdEmptyHint')}</span>
    </div>;
  }

  const tone = summary.errors ? 'danger' : summary.warnings ? 'warning' : 'success';
  return (
    <div className={styles.erdBody}>
      <VerdictStrip
        tone={tone}
        headline={t('erdSummary', { entities: summary.entities, attributes: summary.attributes, relationships: summary.relationships })}
        detail={summary.errors || summary.warnings
          ? t('erdIssueCount', { errors: summary.errors, warnings: summary.warnings })
          : t('erdNormalized')}
      />
      <div className={styles.erdCanvas} role="img" aria-label={t('erdAria', { entities: summary.entities })}>
        <div className={styles.erdStage} style={{ width: layout.width, height: layout.height }}>
          <svg className={styles.erdLines} width={layout.width} height={layout.height} aria-hidden="true">
            {layout.edges.map(({ relationship, from, to }, index) => {
              // Anchor on the facing edge of each card so a line never crosses
              // the box it is pointing at.
              const fromRight = from.x + from.width <= to.x;
              const x1 = fromRight ? from.x + from.width : from.x;
              const y1 = from.y + Math.min(from.height / 2, 40);
              const x2 = fromRight ? to.x : to.x + to.width;
              const y2 = to.y + Math.min(to.height / 2, 40);
              const mid = (x1 + x2) / 2;
              return (
                <g key={`${relationship.from.entity}-${relationship.to.entity}-${index}`}>
                  <path d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} className={styles.erdLine} />
                  <circle cx={x2} cy={y2} r={3} className={styles.erdLineEnd} />
                </g>
              );
            })}
          </svg>
          {layout.entities.map(({ entity, x, y, width }) => {
            const key = entityKey(entity);
            return (
              <div key={entity.name} className={styles.erdEntity} style={{ left: x, top: y, width }}>
                <header>{entity.name}</header>
                <ul>
                  {entity.attributes.slice(0, 24).map((attribute) => (
                    <li key={attribute.name} data-key={key.includes(attribute.name) ? 'pk' : attribute.references ? 'fk' : undefined}>
                      <b>{attribute.name}</b>
                      <span>{attribute.type}</span>
                      {key.includes(attribute.name) ? <i data-mark="pk">{t('erdPk')}</i>
                        : attribute.references ? <i data-mark="fk">{t('erdFk')}</i> : null}
                      {attribute.pii && attribute.pii !== 'none' ? <i data-mark="pii">{t('erdPii')}</i> : null}
                    </li>
                  ))}
                  {entity.attributes.length > 24
                    ? <li data-more="true"><b>{t('erdMoreAttributes', { count: entity.attributes.length - 24 })}</b></li>
                    : null}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
      {issues.length ? <ErdIssueList issues={issues} /> : null}
    </div>
  );
}

function ErdIssueList({ issues }: { issues: readonly DataModelIssue[] }) {
  const t = useTranslations('creationCanvas.node');
  const detailText = useDetailFormatter();
  return (
    <ul className={styles.dataIssueList}>
      {issues.slice(0, 8).map((issue, index) => (
        <li key={`${issue.rule}-${issue.entity ?? ''}-${issue.attribute ?? ''}-${index}`} data-severity={issue.severity}>
          <b>{issue.entity ? `${issue.entity}${issue.attribute ? `.${issue.attribute}` : ''}` : t('erdModelScope')}</b>
          <span>{[t(`erdIssue_${issue.rule}`), detailText(issue.detail)].filter(Boolean).join(' — ')}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Data source
// ---------------------------------------------------------------------------

export function DataSourceBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const tables = asArray(data.tables) as Array<{ name?: string; schema?: string; columns?: unknown[] }>;
  const connected = typeof data.connectionId === 'string' && data.connectionId.length > 0;
  const rowCount = Number(data.rowCount) || 0;

  if (!connected) {
    return <div className={styles.dataEmpty}>
      <strong>{t('datasourceEmptyTitle')}</strong>
      <span>{t('datasourceEmptyHint')}</span>
    </div>;
  }

  return (
    <div className={styles.dataSourceBody}>
      <VerdictStrip
        tone="info"
        headline={String(data.providerLabel || data.provider || t('datasourceConnected'))}
        detail={tables.length ? t('datasourceTableCount', { count: tables.length }) : t('datasourceNoSchema')}
      />
      {typeof data.sql === 'string' && data.sql.trim()
        ? <pre className={styles.dataSql}>{data.sql.trim().slice(0, 600)}</pre>
        : null}
      {tables.length ? (
        <ul className={styles.dataTableList}>
          {tables.slice(0, 14).map((table, index) => (
            <li key={`${table.schema ?? ''}.${table.name ?? index}`}>
              <b>{table.name ?? ''}</b>
              <span>{t('datasourceColumnCount', { count: asArray(table.columns).length })}</span>
            </li>
          ))}
          {tables.length > 14 ? <li data-more="true"><b>{t('datasourceMoreTables', { count: tables.length - 14 })}</b></li> : null}
        </ul>
      ) : null}
      {rowCount ? <div className={styles.dataFooter}>{t('datasourceLastRead', { rows: rowCount })}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data contract
// ---------------------------------------------------------------------------

export function DataContractBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const detailText = useDetailFormatter();
  const contract = useMemo(() => normalizeDataContract(data.dataContract), [data.dataContract]);
  const violations = useMemo(() => asArray(data.violations) as ContractViolation[], [data.violations]);

  if (!contract?.columns.length) {
    return <div className={styles.dataEmpty}>
      <strong>{t('contractEmptyTitle')}</strong>
      <span>{t('contractEmptyHint')}</span>
    </div>;
  }

  const errors = violations.filter((violation) => violation.severity === 'error').length;
  const warnings = violations.length - errors;
  return (
    <div className={styles.dataContractBody}>
      <VerdictStrip
        tone={errors ? 'danger' : warnings ? 'warning' : 'success'}
        headline={errors || warnings ? t('contractDrift', { errors, warnings }) : t('contractHonoured')}
        detail={t('contractShape', { columns: contract.columns.length, key: contract.primaryKey?.join(', ') || t('contractNoKey') })}
      />
      <ul className={styles.dataColumnList}>
        {contract.columns.slice(0, 18).map((column) => (
          <li key={column.name}>
            <b>{column.name}</b>
            <span>{column.type}</span>
            <em>
              {[column.required ? t('contractRequired') : '', column.unique ? t('contractUnique') : '', column.unit ?? '']
                .filter(Boolean).join(' · ')}
            </em>
            {column.pii && column.pii !== 'none' ? <i data-mark="pii">{t(`piiCategory_${column.pii}`)}</i> : null}
          </li>
        ))}
        {contract.columns.length > 18
          ? <li data-more="true"><b>{t('contractMoreColumns', { count: contract.columns.length - 18 })}</b></li>
          : null}
      </ul>
      {violations.length ? (
        <ul className={styles.dataIssueList}>
          {violations.slice(0, 6).map((violation, index) => (
            <li key={`${violation.rule}-${violation.column ?? ''}-${index}`} data-severity={violation.severity}>
              <b>{violation.column ?? t('contractDatasetScope')}</b>
              <span>{[t(`contractViolation_${violation.rule}`), detailText(violation.detail)].filter(Boolean).join(' — ')}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

export function DataQualityBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const detailText = useDetailFormatter();
  const results = useMemo(() => asArray(data.results) as DataQualityResult[], [data.results]);
  const checks = asArray(data.checks);

  if (!results.length) {
    return <div className={styles.dataEmpty}>
      <strong>{checks.length ? t('qualityNotRunTitle') : t('qualityEmptyTitle')}</strong>
      <span>{checks.length ? t('qualityNotRunHint', { count: checks.length }) : t('qualityEmptyHint')}</span>
    </div>;
  }

  const verdict = dataQualityVerdict(results);
  return (
    <div className={styles.dataQualityBody}>
      <VerdictStrip
        tone={verdict.status === 'fail' ? 'danger' : verdict.status === 'warn' ? 'warning' : 'success'}
        headline={t('qualityScore', { score: verdict.score })}
        detail={t('qualityBreakdown', { passed: verdict.passed, failed: verdict.failed, warned: verdict.warned, skipped: verdict.skipped })}
      />
      <ul className={styles.dataCheckList}>
        {results.slice(0, 12).map((result) => (
          <li key={result.id} data-status={result.status}>
            <i aria-hidden="true" />
            <b>{result.column ? `${t(`qualityCheck_${result.kind}`)} · ${result.column}` : t(`qualityCheck_${result.kind}`)}</b>
            <span>{[t(`qualityStatus_${result.status}`), detailText(result.detail)].filter(Boolean).join(' — ')}</span>
            {result.samples?.length ? <em>{result.samples.slice(0, 3).join(', ')}</em> : null}
          </li>
        ))}
        {results.length > 12 ? <li data-more="true"><b>{t('qualityMoreChecks', { count: results.length - 12 })}</b></li> : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric definition (the semantic layer)
// ---------------------------------------------------------------------------

export function MetricDefinitionBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const definition = useMemo(() => normalizeMetricDefinition(data.definition), [data.definition]);

  if (!definition) {
    return <div className={styles.dataEmpty}>
      <strong>{t('metricEmptyTitle')}</strong>
      <span>{t('metricEmptyHint')}</span>
    </div>;
  }

  const value = Number(data.value);
  const hasValue = Number.isFinite(value) && data.value !== '' && data.value != null;
  const attainment = definition.target ? Math.round((definition.direction === 'down' ? definition.target / (value || 1) : value / definition.target) * 100) : null;
  const tone = attainment == null ? 'info' : attainment >= 100 ? 'success' : attainment >= 90 ? 'warning' : 'danger';

  return (
    <div className={styles.metricDefinitionBody}>
      <div className={styles.metricValueRow}>
        <strong>{hasValue ? formatMetricValue(value, definition) : t('metricNotComputed')}</strong>
        {definition.target != null
          ? <span>{t('metricTarget', { target: formatMetricValue(definition.target, definition) })}</span>
          : null}
      </div>
      <VerdictStrip
        tone={tone}
        headline={t('metricFormula', {
          op: t(`aggregateOp_${definition.aggregate.op}`),
          column: definition.aggregate.column ?? t('metricAllRows'),
        })}
        detail={[
          definition.timeGrain ? t('metricByGrain', { grain: t(`timeGrain_${definition.timeGrain.grain}`) }) : '',
          definition.dimension ? t('metricByDimension', { dimension: definition.dimension }) : '',
          definition.filter?.length ? t('metricFilterCount', { count: definition.filter.length }) : '',
        ].filter(Boolean).join(' · ') || undefined}
      />
      {definition.description ? <p className={styles.dataNote}>{definition.description}</p> : null}
      <div className={styles.dataFooter}>{t('metricIdLabel', { id: definition.id })}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

interface LineageNodeShape { id: string; title?: string; kind?: string; role?: string; stale?: boolean }
interface LineageEdgeShape { from: string; to: string; engine?: string }

export function LineageBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const nodes = useMemo(() => asArray(data.lineageNodes) as LineageNodeShape[], [data.lineageNodes]);
  const edges = useMemo(() => asArray(data.lineageEdges) as LineageEdgeShape[], [data.lineageEdges]);
  const stale = asArray(data.staleDerivatives) as Array<{ title?: string; sourceTitle?: string }>;

  if (!nodes.length) {
    return <div className={styles.dataEmpty}>
      <strong>{t('lineageEmptyTitle')}</strong>
      <span>{t('lineageEmptyHint')}</span>
    </div>;
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <div className={styles.lineageBody}>
      <VerdictStrip
        tone={stale.length ? 'warning' : 'success'}
        headline={t('lineageSummary', { objects: nodes.length, links: edges.length })}
        detail={stale.length ? t('lineageStaleCount', { count: stale.length }) : t('lineageAllCurrent')}
      />
      <ul className={styles.lineageFlow}>
        {edges.slice(0, 12).map((edge, index) => (
          <li key={`${edge.from}-${edge.to}-${index}`}>
            <b data-role={byId.get(edge.from)?.role ?? 'source'}>{byId.get(edge.from)?.title ?? edge.from}</b>
            <span>{t(`lineageEngine_${edge.engine ?? 'tabular'}`)}</span>
            <b data-role={byId.get(edge.to)?.role ?? 'derived'} data-stale={byId.get(edge.to)?.stale ? 'true' : undefined}>
              {byId.get(edge.to)?.title ?? edge.to}
            </b>
          </li>
        ))}
        {edges.length > 12 ? <li data-more="true"><b>{t('lineageMoreLinks', { count: edges.length - 12 })}</b></li> : null}
      </ul>
      {stale.length ? (
        <ul className={styles.dataIssueList}>
          {stale.slice(0, 4).map((entry, index) => (
            <li key={`${entry.title ?? ''}-${index}`} data-severity="warning">
              <b>{entry.title ?? ''}</b>
              <span>{t('lineageStaleDetail', { source: entry.sourceTitle ?? '' })}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
