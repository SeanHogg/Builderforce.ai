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
} from '@/lib/projectEvermindApi';

/**
 * ProjectEvermindPanel — the web host of the shared <EvermindConsole> (the SAME
 * component the VS Code sidebar renders, so the inspect-and-train surface is one
 * source of truth: [[evermind-learning-architecture]]). This wrapper supplies only
 * the two host seams: an adapter mapping the console's data/mutations to
 * `projectEvermindApi`, and a next-intl label bundle. Manager-gating rides the
 * `canManage` prop (the console disables — never hides — the write controls).
 */
export function ProjectEvermindPanel({ projectId }: { projectId: number }) {
  const t = useTranslations('projectEvermind');
  const format = useFormatter();
  const { allowed: canManage } = usePermission('project.manageEvermind');
  const { codingModels, isPaid } = useLlmModels();

  const adapter = useMemo<EvermindConsoleAdapter>(() => ({
    loadData: () => getProjectEvermindContributions(projectId),
    loadSeedModels: async () => (await listEvermindModels()).map((m) => ({ slug: m.slug, name: m.name })),
    loadTeacherOptions: async () => ({ models: codingModels, isPaid }),
    seedFromModel: async (slug) => { await seedProjectEvermindFromModel(projectId, slug); },
    setInference: async (enabled) => { await setProjectEvermindInference(projectId, enabled); },
    setMode: async (mode) => { await setProjectEvermindMode(projectId, mode); },
    setTeacher: async (model) => { await setProjectEvermindTeacher(projectId, model); },
    teach: async (text, prompt) => { await teachProjectEvermindFromText(projectId, text, prompt); },
    flush: async () => { const r = await flushProjectEvermind(projectId); return { merged: r.merged, version: r.version }; },
  }), [projectId, codingModels, isPaid]);

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
    teachTitle: t('teachTitle'),
    teachHint: t('teachHint'),
    teachPromptPlaceholder: t('teachPromptPlaceholder'),
    teachTextPlaceholder: t('teachTextPlaceholder'),
    teachCta: t('teachCta'),
    teaching: t('teaching'),
    taught: t('taught'),
    flushCta: t('flushCta'),
    flushing: t('flushing'),
    flushedNone: t('flushedNone'),
    flushedN: (merged, version) => t('flushedN', { merged, version }),
    inspectTitle: t('inspectTitle'),
    inspectEmpty: t('inspectEmpty'),
    kindText: t('kindText'),
    kindDelta: t('kindDelta'),
    deltaEntry: t('deltaEntry'),
    versionTag: (v) => t('versionTag', { version: v }),
    weightTag: (w) => t('weightTag', { weight: w }),
    refresh: t('refresh'),
    errorGeneric: t('errorGeneric'),
  }), [t, format]);

  // A margin-bottom to match the panel's old placement in the IDE agent stack.
  return (
    <div style={{ marginBottom: 12 }}>
      <EvermindConsole adapter={adapter} canManage={canManage} labels={{ ...DEFAULT_EVERMIND_LABELS, ...labels }} />
    </div>
  );
}
