'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  EvermindConsole,
  DEFAULT_EVERMIND_LABELS,
  type EvermindConsoleAdapter,
  type EvermindConsoleLabels,
} from '@seanhogg/builderforce-brain-ui';
import { usePermission } from '@/lib/rbac';
import { fetchProject } from '@/lib/api';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { listEvermindModels } from '@/lib/studioModelsApi';
import { useLlmModels } from '@/lib/useLlmModels';
import {
  getProjectEvermindContributions,
  listProjectEvermindTargets,
  seedProjectEvermindFromModel,
  setProjectEvermindInference,
  setProjectEvermindMode,
  setProjectEvermindTeacher,
  teachProjectEvermindFromText,
  getProjectEvermindContributionStatus,
  flushProjectEvermind,
  validateProjectEvermind,
  probeProjectEvermind,
  reseedProjectEvermind,
  reindexProjectEvermind,
  cleanupProjectEvermind,
  analyzeProjectEvermind,
  applyProjectEvermindFindings,
} from '@/lib/projectEvermindApi';
import { useEvermindValidation } from './EvermindValidationContext';

/**
 * ProjectEvermindPanel — the web host of the shared <EvermindConsole> (the SAME
 * component the VS Code sidebar renders, so the inspect-and-train surface is one
 * source of truth: [[evermind-learning-architecture]]). This wrapper supplies only
 * the two host seams: an adapter mapping the console's data/mutations to
 * `projectEvermindApi`, and a next-intl label bundle. Manager-gating rides the
 * `canManage` prop (the console disables — never hides — the write controls).
 */
export function ProjectEvermindPanel({ projectId, showRecent = true }: { projectId: number; showRecent?: boolean }) {
  const t = useTranslations('projectEvermind');
  const format = useFormatter();
  const { allowed: canManage } = usePermission('project.manageEvermind');
  // Resolve the scoped project's name (DRY — from the shared projects list, no
  // prop-drilling through the host call sites) so the console header names WHICH
  // project's Evermind this is.
  const scopedName = useOptionalProjectScope()?.projects.find((p) => p.id === projectId)?.name;
  // Canvas builds are backed by a hidden `is_ide_storage` project, which the shared
  // list deliberately filters out — so every Builder host (Designer/Voice/Video/agent
  // panel) fell through to a nameless header. Fetch the project directly in that
  // case only; the list covers every other host with no request at all.
  const [fetchedName, setFetchedName] = useState<string | undefined>();
  useEffect(() => {
    if (scopedName || !Number.isFinite(projectId)) return;
    let cancelled = false;
    fetchProject(projectId)
      .then((p) => { if (!cancelled) setFetchedName(p.name); })
      .catch(() => { /* header just omits the name */ });
    return () => { cancelled = true; };
  }, [scopedName, projectId]);
  const projectName = scopedName ?? fetchedName;
  // Frontier teacher gate + options. Gate: the server's unified frontier-access rule
  // (superadmin || premium override || connected BYO account || paid plan) — NOT bare
  // `isPaid` — so a superadmin or a BYO tenant is never shown a false "paid plans only"
  // wall (the console reads the returned `isPaid` flag to lock/unlock the teacher).
  // Options: `teacherModels` — the tenant's OWN connected frontier models (a BYO-Anthropic
  // tenant teaches with Opus/Sonnet) plus platform premium coders when we fund them — NOT
  // the plan `codingModels` (free coders on the free plan).
  const { teacherModels, canUseFrontierModels } = useLlmModels();
  // Lift the Validate recall result to the shared studio highlight (inert when this
  // panel renders outside the studio — the console still shows its own inline result).
  const { setHighlight } = useEvermindValidation();

  const adapter = useMemo<EvermindConsoleAdapter>(() => ({
    loadData: () => getProjectEvermindContributions(projectId),
    loadSeedModels: async () => (await listEvermindModels()).map((m) => ({ slug: m.slug, name: m.name })),
    loadTeacherOptions: async () => ({ models: teacherModels, isPaid: canUseFrontierModels }),
    seedFromModel: async (slug) => { await seedProjectEvermindFromModel(projectId, slug); },
    setInference: async (enabled) => { await setProjectEvermindInference(projectId, enabled); },
    setMode: async (mode) => { await setProjectEvermindMode(projectId, mode); },
    setTeacher: async (model) => { await setProjectEvermindTeacher(projectId, model); },
    // The teach POST is ACCEPTANCE, not success — the teacher runs later, in the
    // coordinator's debounced merge. Hand the console the contribution id so it can
    // poll `teachStatus` and correct its optimistic toast with the real outcome.
    teach: async (text, prompt) => {
      const r = await teachProjectEvermindFromText(projectId, text, prompt);
      return r.contributionId ? { contributionId: r.contributionId } : {};
    },
    teachStatus: (contributionId) => getProjectEvermindContributionStatus(projectId, contributionId),
    flush: async () => { const r = await flushProjectEvermind(projectId); return { merged: r.merged, version: r.version }; },
    validate: (prompt) => validateProjectEvermind(projectId, prompt),
    loadTargets: () => listProjectEvermindTargets(projectId),
    // Test bench + maintenance + knowledge audit. All plain REST on this project, so
    // the web host implements every one; the console self-gates on their presence.
    probe: (prompt) => probeProjectEvermind(projectId, prompt),
    reseed: async (slug) => { const r = await reseedProjectEvermind(projectId, slug); return { version: r.version }; },
    reindex: async () => {
      const r = await reindexProjectEvermind(projectId);
      return { reindexed: r.reindexed, skipped: r.skipped, version: r.version };
    },
    cleanup: async () => {
      const r = await cleanupProjectEvermind(projectId);
      return { discarded: r.discarded, cachedAnswers: r.cachedAnswers };
    },
    analyze: () => analyzeProjectEvermind(projectId),
    applyFindings: (findings) => applyProjectEvermindFindings(projectId, findings),
  }), [projectId, teacherModels, canUseFrontierModels]);

  const labels = useMemo<Partial<EvermindConsoleLabels>>(() => ({
    title: t('title'),
    description: t('description'),
    loading: t('loading'),
    managerOnlyHint: t('managerOnlyHint'),
    inheritedHint: t('inheritedHint'),
    statusSeeded: (v) => t('statusSeeded', { version: v }),
    statusUnseeded: t('statusUnseeded'),
    quarantinedBadge: t('quarantinedBadge'),
    quarantinedHint: (reason) => t('quarantinedHint', { reason }),
    targetsTitle: t('targetsTitle'),
    targetsHint: t('targetsHint'),
    targetsEmpty: t('targetsEmpty'),
    targetSelfBadge: t('targetSelfBadge'),
    targetBuildBadge: t('targetBuildBadge'),
    targetSeeded: (version) => t('targetSeeded', { version }),
    targetUnseeded: t('targetUnseeded'),
    targetInferenceOn: t('targetInferenceOn'),
    targetConnected: t('targetConnected'),
    targetFrozen: t('targetFrozen'),
    targetProjectId: (id) => t('targetProjectId', { id }),
    evalDelta: (pct) => t('evalDelta', { pct }),
    evalFlat: t('evalFlat'),
    evalTooltip: (version, base, next, size) => t('evalTooltip', { version, base, next, size }),
    pickModelLabel: t('pickModelLabel'),
    noModels: t('noModels'),
    notSetUp: t('notSetUp'),
    enableCta: t('enableCta'),
    working: t('working'),
    versionLabel: t('versionLabel'),
    contributionsLabel: t('contributionsLabel'),
    pendingLabel: t('pendingLabel'),
    lastLearnedLabel: t('lastLearnedLabel'),
    neverLearned: t('neverLearned'),
    formatWhen: (atMs) => format.relativeTime(new Date(atMs)),
    inferenceLabel: t('inferenceLabel'),
    inferenceHint: t('inferenceHint'),
    learningLabel: t('learningLabel'),
    learningHint: t('learningHint'),
    on: t('on'),
    off: t('off'),
    connected: t('connected'),
    frozen: t('frozen'),
    teacherLabel: t('teacherLabel'),
    teacherHint: t('teacherHint'),
    teacherNone: t('teacherNone'),
    teacherPaidOnly: t('teacherPaidOnly'),
    teacherActiveHint: (model) => t('teacherActiveHint', { model }),
    teachTitle: t('teachTitle'),
    teachHint: t('teachHint'),
    teachPromptPlaceholder: t('teachPromptPlaceholder'),
    teachTextPlaceholder: t('teachTextPlaceholder'),
    teachCta: t('teachCta'),
    teaching: t('teaching'),
    taught: t('taught'),
    taughtDistilled: (model, version) => t('taughtDistilled', { model, version }),
    taughtSelf: (version) => t('taughtSelf', { version }),
    taughtTeacherFault: (model, reason) => t('taughtTeacherFault', { model, reason }),
    taughtDropped: t('taughtDropped'),
    taughtStillPending: t('taughtStillPending'),
    teachTeacherTitle: t('teachTeacherTitle'),
    teachTeacherHint: (model) => t('teachTeacherHint', { model }),
    teachTaskPlaceholder: t('teachTaskPlaceholder'),
    teachTeacherCta: t('teachTeacherCta'),
    flushCta: t('flushCta'),
    flushing: t('flushing'),
    flushedNone: t('flushedNone'),
    flushedN: (merged, version) => t('flushedN', { merged, version }),
    validateCta: t('validateCta'),
    validating: t('validating'),
    validateHint: t('validateHint'),
    validateResultTitle: (prompt) => t('validateResultTitle', { prompt }),
    validateEmpty: t('validateEmpty'),
    validatePrimaryBadge: t('validatePrimaryBadge'),
    validateScore: (pct) => t('validateScore', { pct }),
    validateClear: t('validateClear'),
    validateMethod: (method) => t('validateMethod', { method }),
    inspectTitle: t('inspectTitle'),
    inspectEmpty: t('inspectEmpty'),
    kindText: t('kindText'),
    kindDelta: t('kindDelta'),
    deltaEntry: t('deltaEntry'),
    versionTag: (v) => t('versionTag', { version: v }),
    weightTag: (w) => t('weightTag', { weight: w }),
    viewDetail: t('viewDetail'),
    hideDetail: t('hideDetail'),
    detailPromptLabel: t('detailPromptLabel'),
    detailTextLabel: t('detailTextLabel'),
    // Test bench
    testTitle: t('testTitle'),
    testHint: t('testHint'),
    testPlaceholder: t('testPlaceholder'),
    testRunCta: t('testRunCta'),
    testReadinessCta: t('testReadinessCta'),
    testRunning: t('testRunning'),
    testResultReadiness: (passed, total) => t('testResultReadiness', { passed, total }),
    testResultPrompt: t('testResultPrompt'),
    testServable: t('testServable'),
    testRefused: t('testRefused'),
    testRefusedBecause: (detail) => t('testRefusedBecause', { detail }),
    testEmptyOutput: t('testEmptyOutput'),
    testVerdictReady: t('testVerdictReady'),
    testVerdictNotReady: t('testVerdictNotReady'),
    // Maintenance
    maintenanceTitle: t('maintenanceTitle'),
    maintenanceHint: t('maintenanceHint'),
    reseedLabel: t('reseedLabel'),
    reseedHint: t('reseedHint'),
    reseedCta: t('reseedCta'),
    reseedConfirm: t('reseedConfirm'),
    reseedStarterOption: t('reseedStarterOption'),
    reseedDone: (version) => t('reseedDone', { version }),
    reindexLabel: t('reindexLabel'),
    reindexHint: t('reindexHint'),
    reindexCta: t('reindexCta'),
    reindexDone: (count) => t('reindexDone', { count }),
    cleanupLabel: t('cleanupLabel'),
    cleanupHint: t('cleanupHint'),
    cleanupCta: t('cleanupCta'),
    cleanupConfirm: t('cleanupConfirm'),
    cleanupDone: (discarded, cached) => t('cleanupDone', { discarded, cached }),
    // Knowledge analyzer
    analyzeTitle: t('analyzeTitle'),
    analyzeHint: t('analyzeHint'),
    analyzeCta: t('analyzeCta'),
    analyzing: t('analyzing'),
    analyzeClean: (analyzed) => t('analyzeClean', { analyzed }),
    analyzeSummary: (issues, analyzed, model) => t('analyzeSummary', { issues, analyzed, model }),
    analyzeSummaryLocal: (issues, analyzed) => t('analyzeSummaryLocal', { issues, analyzed }),
    analyzeVerdict: (verdict) => t('analyzeVerdict', { verdict }),
    analyzeCorrectionLabel: t('analyzeCorrectionLabel'),
    analyzeSelectAll: t('analyzeSelectAll'),
    analyzeSelectNone: t('analyzeSelectNone'),
    analyzeApplyCta: (count) => t('analyzeApplyCta', { count }),
    analyzeApplying: t('analyzeApplying'),
    analyzeApplied: (corrected, forgotten, version) => t('analyzeApplied', { corrected, forgotten, version }),
    analyzeSkipped: (count) => t('analyzeSkipped', { count }),
    // Tabs
    tabsLabel: t('tabsLabel'),
    tabTeach: t('tabTeach'),
    tabTest: t('tabTest'),
    tabCheck: t('tabCheck'),
    tabMaintain: t('tabMaintain'),
    // Diagnostics export (the report BODY is an unlocalized technical artifact —
    // see diagnosticsReport.ts; these controls are localized like everything else).
    diagnosticsTitle: t('diagnosticsTitle'),
    diagnosticsHint: t('diagnosticsHint'),
    diagnosticsCta: t('diagnosticsCta'),
    diagnosticsCopied: t('diagnosticsCopied'),
    diagnosticsShow: t('diagnosticsShow'),
    diagnosticsHide: t('diagnosticsHide'),
    diagnosticsManualHint: t('diagnosticsManualHint'),
    refresh: t('refresh'),
    errorGeneric: t('errorGeneric'),
  }), [t, format]);

  // A margin-bottom to match the panel's placement in the Builder agent stack.
  return (
    <div style={{ marginBottom: 12 }}>
      <EvermindConsole adapter={adapter} canManage={canManage} projectName={projectName} showRecent={showRecent} onValidate={setHighlight} labels={{ ...DEFAULT_EVERMIND_LABELS, ...labels }} />
    </div>
  );
}
