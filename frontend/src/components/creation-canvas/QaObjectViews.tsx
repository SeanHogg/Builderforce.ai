'use client';

/**
 * Node bodies for the QA objects — plan, case, run, defect — plus the page-audit
 * section the `diagnostics` card renders when an audit is attached.
 *
 * They live here for the same reason the data-architecture bodies do: `CreationNode`
 * is already the widest dispatch in the codebase, and a step list, a spec preview and
 * a gate strip have nothing to do with the other hundred kinds.
 *
 * Two conventions carried over deliberately:
 *  • The verdict strip is IMPORTED, not copied — a red suite and a red run have to
 *    look like the same severity of the same thing.
 *  • Nothing renders a pre-built English sentence. Every row is a `rule`/`action`
 *    key plus a `detail` map interpolated into a localized string here, which is what
 *    makes five languages one code path instead of five.
 *
 * Colour comes from the canvas palette and the shared tone tokens, which the board
 * declares for BOTH themes, so there is not a literal in this file.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import type { CreationNodeData } from './types';
import { VerdictStrip } from './DataArchitectureViews';
import {
  normalizeExitCriteria, planGateVerdict, readTestCases, readTestResults, summarizeRun,
  type CanvasGateCheck,
} from '@/lib/canvasQa';
import { readAuditFindings, type AuditFinding } from '@/lib/canvasPageAudit';
import { normalizeQaSteps, severityRank, type QaFindingSeverity, type QaStep } from '@builderforce/creation-canvas-contract';

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** One localized step row. Shared by the case body and the defect repro list so a
 *  step never reads two different ways on the same board. */
function StepList({ steps, limit = 12 }: { steps: readonly QaStep[]; limit?: number }) {
  const t = useTranslations('creationCanvas.node');
  if (!steps.length) return null;
  return (
    <ol className={styles.qaStepList}>
      {steps.slice(0, limit).map((step, index) => (
        <li key={`${step.action}-${index}`} data-action={step.action}>
          <b>{t(`qaStep_${step.action}`)}</b>
          <span>{step.route ?? step.selector ?? step.value ?? ''}</span>
          {step.assertion ? <em>{step.assertion}</em> : null}
        </li>
      ))}
      {steps.length > limit ? <li data-more="true"><b>{t('qaMoreSteps', { count: steps.length - limit })}</b></li> : null}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Test plan — the intent and the gate
// ---------------------------------------------------------------------------

export function TestPlanBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const criteria = useMemo(() => normalizeExitCriteria(data.exitCriteria), [data.exitCriteria]);
  const routes = useMemo(() => asArray(data.routes).filter((route): route is string => typeof route === 'string'), [data.routes]);
  const target = text(data.targetUrl);
  // The verdict is DERIVED here rather than read off the object: a stored verdict is
  // a claim, and a claim can outlive the run that justified it.
  const verdict = useMemo(() => {
    const gate = data.gateVerdict as { checks?: CanvasGateCheck[]; status?: string; score?: number } | undefined;
    return gate?.checks
      ? { status: gate.status ?? 'pending', score: gate.score ?? 0, checks: gate.checks }
      : planGateVerdict(criteria, { runs: [], defects: [], audits: [], signOffs: [] });
  }, [criteria, data.gateVerdict]);
  const caseCount = Number(data.caseCount) || 0;

  if (!target && !routes.length) {
    return <div className={styles.dataEmpty}>
      <strong>{t('testPlanEmptyTitle')}</strong>
      <span>{t('testPlanEmptyHint')}</span>
    </div>;
  }

  const tone = verdict.status === 'pass' ? 'success' : verdict.status === 'fail' ? 'danger' : 'info';
  return (
    <div className={styles.qaPlanBody}>
      <VerdictStrip
        tone={tone}
        headline={t(`gateStatus_${verdict.status}`)}
        detail={verdict.checks.length ? t('gateScore', { score: verdict.score }) : t('gateNoCriteria')}
      />
      <div className={styles.qaPlanMeta}>
        <span><small>{t('testPlanTarget')}</small><b>{target || '—'}</b></span>
        <span><small>{t('testPlanRoutes')}</small><b>{routes.length}</b></span>
        <span><small>{t('testPlanCases')}</small><b>{caseCount}</b></span>
      </div>
      {verdict.checks.length ? (
        <ul className={styles.dataCheckList}>
          {verdict.checks.slice(0, 8).map((check, index) => (
            <li key={`${check.rule}-${index}`} data-status={check.ok ? 'pass' : 'fail'}>
              <i aria-hidden="true" />
              <b>{t(`gateRule_${check.rule}`)}</b>
              <span>{gateDetail(check, t)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {routes.length ? (
        <ul className={styles.qaRouteList}>
          {routes.slice(0, 10).map((route) => <li key={route}>{route}</li>)}
          {routes.length > 10 ? <li data-more="true">{t('qaMoreRoutes', { count: routes.length - 10 })}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Localized evidence for one gate check. The keys VARY by rule, so each is named
 *  explicitly rather than interpolated from an arbitrary map. */
function gateDetail(check: CanvasGateCheck, t: ReturnType<typeof useTranslations>): string {
  const detail = check.detail ?? {};
  switch (check.rule) {
    case 'passRate': return t('gateDetailPassRate', { actual: Number(detail.actual ?? 0), required: Number(detail.required ?? 0) });
    case 'hasRun': return t('gateDetailNoRun');
    case 'openDefects': return t('gateDetailDefects', { actual: Number(detail.actual ?? 0), allowed: Number(detail.allowed ?? 0) });
    case 'severeDefects': return t('gateDetailSevere', { actual: Number(detail.actual ?? 0), allowed: Number(detail.allowed ?? 0) });
    case 'accessibility': return t('gateDetailAccessibility', { audits: Number(detail.audits ?? 0) });
    case 'signOff': return t('gateDetailSignOff', { owner: String(detail.owner ?? '') });
  }
}

// ---------------------------------------------------------------------------
// Test case — the steps and the spec that runs them
// ---------------------------------------------------------------------------

export function TestCaseBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const steps = useMemo(() => normalizeQaSteps(data.steps), [data.steps]);
  const spec = text(data.spec);
  const last = text(data.lastStatus);

  if (!steps.length && !spec) {
    return <div className={styles.dataEmpty}>
      <strong>{t('testCaseEmptyTitle')}</strong>
      <span>{t('testCaseEmptyHint')}</span>
    </div>;
  }

  return (
    <div className={styles.qaCaseBody}>
      <VerdictStrip
        tone={last === 'passed' ? 'success' : last === 'failed' || last === 'error' ? 'danger' : 'info'}
        headline={last ? t(`runStatus_${last}`) : t('testCaseNotRun')}
        detail={t('testCaseStepCount', { count: steps.length, priority: t(`casePriority_${text(data.priority) || 'normal'}`) })}
      />
      <StepList steps={steps} />
      {spec ? <pre className={styles.qaSpec}>{spec.slice(0, 1_400)}</pre> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test run — the evidence
// ---------------------------------------------------------------------------

export function TestRunBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const results = useMemo(() => readTestResults(data.results), [data.results]);
  const summary = useMemo(() => summarizeRun(results), [results]);

  if (!results.length) {
    return <div className={styles.dataEmpty}>
      <strong>{t('testRunEmptyTitle')}</strong>
      <span>{t('testRunEmptyHint')}</span>
    </div>;
  }

  return (
    <div className={styles.qaRunBody}>
      <VerdictStrip
        tone={summary.status === 'passed' ? 'success' : 'danger'}
        headline={t('runPassRate', { rate: summary.passRate })}
        detail={t('runBreakdown', { passed: summary.passed, failed: summary.failed, errored: summary.errored, skipped: summary.skipped })}
      />
      <ul className={styles.dataCheckList}>
        {results.slice(0, 14).map((result, index) => (
          <li key={`${result.caseId}-${index}`} data-status={result.status === 'passed' ? 'pass' : result.status === 'skipped' ? 'skip' : 'fail'}>
            <i aria-hidden="true" />
            <b>{result.title || result.caseId}</b>
            <span>{[t(`runStatus_${result.status}`), result.durationMs != null ? t('runDuration', { ms: result.durationMs }) : ''].filter(Boolean).join(' — ')}</span>
            {result.errorMessage ? <em>{result.errorMessage.slice(0, 220)}</em> : null}
          </li>
        ))}
        {results.length > 14 ? <li data-more="true"><b>{t('qaMoreResults', { count: results.length - 14 })}</b></li> : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Defect — what broke, and how to see it again
// ---------------------------------------------------------------------------

const DEFAULT_SEVERITY: QaFindingSeverity = 'medium';

export function DefectBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const severity = (['low', 'medium', 'high', 'critical'] as const).includes(data.severity as QaFindingSeverity)
    ? data.severity as QaFindingSeverity
    : DEFAULT_SEVERITY;
  const steps = useMemo(() => normalizeQaSteps(data.reproSteps), [data.reproSteps]);
  const journal = useMemo(() => asArray(data.journal) as Array<{ label?: string; detail?: string; ok?: boolean; durationMs?: number }>, [data.journal]);
  const expected = text(data.expected);
  const actual = text(data.actual);

  if (!expected && !actual && !steps.length) {
    return <div className={styles.dataEmpty}>
      <strong>{t('defectEmptyTitle')}</strong>
      <span>{t('defectEmptyHint')}</span>
    </div>;
  }

  return (
    <div className={styles.qaDefectBody}>
      <VerdictStrip
        tone={severityRank(severity) >= severityRank('high') ? 'danger' : severityRank(severity) === severityRank('medium') ? 'warning' : 'info'}
        headline={t(`defectSeverity_${severity}`)}
        detail={[
          t(`defectType_${text(data.defectType) || 'assertion'}`),
          text(data.route) || text(data.targetUrl),
        ].filter(Boolean).join(' · ')}
      />
      <dl className={styles.qaExpectation}>
        <dt>{t('defectExpected')}</dt><dd>{expected || '—'}</dd>
        <dt>{t('defectActual')}</dt><dd>{actual || '—'}</dd>
      </dl>
      <StepList steps={steps} limit={8} />
      {journal.length ? (
        <ul className={styles.qaJournalList} aria-label={t('defectJournal')}>
          {journal.slice(0, 6).map((entry, index) => (
            <li key={`${entry.label ?? ''}-${index}`} data-ok={entry.ok === false ? 'false' : 'true'}>
              <b>{entry.label ?? ''}</b>
              <span>{[entry.detail ?? '', entry.durationMs != null ? t('runDuration', { ms: entry.durationMs }) : ''].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
          {journal.length > 6 ? <li data-more="true"><b>{t('qaMoreJournal', { count: journal.length - 6 })}</b></li> : null}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page audit — rendered inside the diagnostics card
// ---------------------------------------------------------------------------

/**
 * The accessibility/performance section of a `diagnostics` object.
 *
 * Returns null when there is no audit on the object, so the diagnostics card mounts
 * it unconditionally and this decides its own visibility — the shared-component rule,
 * rather than a `hasAudit` boolean the caller would have to compute.
 */
export function PageAuditFindings({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const findings = useMemo(() => readAuditFindings(data.auditFindings), [data.auditFindings]);
  if (!findings.length) return null;

  const failed = findings.filter((finding) => finding.count > 0);
  const score = Number(data.auditScore);
  const passed = data.auditPassed === true;
  return (
    <div className={styles.qaAuditBody}>
      <VerdictStrip
        tone={passed ? 'success' : failed.some((finding) => finding.severity === 'critical') ? 'danger' : 'warning'}
        headline={t('auditScore', { score: Number.isFinite(score) ? score : 0 })}
        detail={t('auditBreakdown', {
          failed: failed.length,
          checked: findings.length,
          target: text(data.auditTarget),
        })}
      />
      <ul className={styles.dataIssueList}>
        {[...failed].sort(bySeverityThenCount).slice(0, 10).map((finding) => (
          <li key={finding.rule} data-severity={finding.severity === 'critical' || finding.severity === 'serious' ? 'error' : 'warning'}>
            <b>{finding.wcag ? t('auditRuleWithWcag', { rule: t(`auditRule_${finding.rule}`), wcag: finding.wcag }) : t(`auditRule_${finding.rule}`)}</b>
            <span>{t('auditOccurrences', { count: finding.count, severity: t(`auditSeverity_${finding.severity}`) })}</span>
            {finding.sample ? <em>{finding.sample.slice(0, 140)}</em> : null}
          </li>
        ))}
      </ul>
      {failed.length === 0 ? <p className={styles.dataNote}>{t('auditAllPassed')}</p> : null}
    </div>
  );
}

const AUDIT_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 } as const;
function bySeverityThenCount(a: AuditFinding, b: AuditFinding): number {
  return AUDIT_ORDER[a.severity] - AUDIT_ORDER[b.severity] || b.count - a.count;
}

/** Case list for the plan's inspector — exported so the canvas does not re-read the
 *  stored shape with its own parser. */
export { readTestCases };
