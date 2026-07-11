'use client';

import { useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  EvermindConsole,
  DEFAULT_EVERMIND_LABELS,
  type EvermindConsoleAdapter,
  type EvermindConsoleLabels,
} from '@seanhogg/builderforce-brain-ui';
import { usePermission } from '@/lib/rbac';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { listEvermindModels } from '@/lib/studioModelsApi';
import { useLlmModels } from '@/lib/useLlmModels';
import {
  getProjectEvermindContributions,
  seedProjectEvermindFromModel,
  setProjectEvermindInference,
  setProjectEvermindMode,
  setProjectEvermindTeacher,
  teachProjectEvermindFromText,
  flushProjectEvermind,
  validateProjectEvermind,
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
  // prop-drilling through the 5 host call sites) so the console header names WHICH
  // project's Evermind this is. Undefined for a project not in the list (header omits it).
  const projectName = useOptionalProjectScope()?.projects.find((p) => p.id === projectId)?.name;
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
    teach: async (text, prompt) => { await teachProjectEvermindFromText(projectId, text, prompt); },
    flush: async () => { const r = await flushProjectEvermind(projectId); return { merged: r.merged, version: r.version }; },
    validate: (prompt) => validateProjectEvermind(projectId, prompt),
  }), [projectId, teacherModels, canUseFrontierModels]);

  const labels = useMemo<Partial<EvermindConsoleLabels>>(() => ({
    title: t('title'),
    description: t('description'),
    loading: t('loading'),
    managerOnlyHint: t('managerOnlyHint'),
    statusSeeded: (v) => t('statusSeeded', { version: v }),
    statusUnseeded: t('statusUnseeded'),
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
    refresh: t('refresh'),
    errorGeneric: t('errorGeneric'),
  }), [t, format]);

  // A margin-bottom to match the panel's old placement in the IDE agent stack.
  return (
    <div style={{ marginBottom: 12 }}>
      <EvermindConsole adapter={adapter} canManage={canManage} projectName={projectName} showRecent={showRecent} onValidate={setHighlight} labels={{ ...DEFAULT_EVERMIND_LABELS, ...labels }} />
    </div>
  );
}
