/**
 * Localized console labels from a host's flat string bundle (`ev.*` keys → text, with
 * `{name}` placeholders in the parametric ones). The console's own defaults are English;
 * a host that translates — the VS Code extension through `vscode.l10n`, Synapse from the
 * same catalogs at build time — hands its bundle here, so the two cannot map the same
 * bundle onto different labels.
 */
import type { EvermindConsoleLabels } from './types';

/** The static strings a bundle may carry. Parametric ones are mapped below. */
const STATIC_KEYS = [
  'title', 'description', 'loading', 'managerOnlyHint', 'statusUnseeded', 'pickModelLabel',
  'noModels', 'notSetUp', 'enableCta', 'working', 'versionLabel', 'contributionsLabel',
  'pendingLabel', 'lastLearnedLabel', 'neverLearned', 'inferenceLabel', 'inferenceHint',
  'learningLabel', 'learningHint', 'on', 'off', 'connected', 'frozen', 'teacherLabel',
  'teacherHint', 'teacherNone', 'teacherPaidOnly', 'teachTitle', 'teachHint',
  'teachPromptPlaceholder', 'teachTextPlaceholder', 'teachCta', 'teaching', 'taught',
  'taughtDropped', 'taughtStillPending',
  'flushCta', 'flushing', 'flushedNone', 'inspectTitle', 'inspectEmpty', 'kindText',
  'kindDelta', 'deltaEntry', 'refresh', 'errorGeneric',
  'importTitle', 'importHint', 'importCta', 'importing', 'importNothing',
  'quarantinedBadge', 'targetsTitle', 'targetsHint', 'targetsEmpty', 'targetSelfBadge',
  'targetBuildBadge', 'targetUnseeded', 'targetInferenceOn', 'targetConnected', 'targetFrozen',
  'testTitle', 'testHint', 'testPlaceholder', 'testRunCta', 'testReadinessCta', 'testRunning',
  'testResultPrompt', 'testServable', 'testRefused', 'testEmptyOutput', 'testVerdictReady',
  'testVerdictNotReady',
  'maintenanceTitle', 'maintenanceHint', 'reseedLabel', 'reseedHint', 'reseedCta',
  'reseedConfirm', 'reseedStarterOption', 'reindexLabel', 'reindexHint', 'reindexCta',
  'cleanupLabel', 'cleanupHint', 'cleanupCta', 'cleanupConfirm',
  'analyzeTitle', 'analyzeHint', 'analyzeCta', 'analyzing', 'analyzeCorrectionLabel',
  'analyzeSelectAll', 'analyzeSelectNone', 'analyzeApplying',
  'tabsLabel', 'tabTeach', 'tabTest', 'tabCheck', 'tabMaintain',
  'diagnosticsTitle', 'diagnosticsHint', 'diagnosticsCta', 'diagnosticsCopied',
  'diagnosticsShow', 'diagnosticsHide', 'diagnosticsManualHint',
] as const satisfies ReadonlyArray<keyof EvermindConsoleLabels>;

/** Fill `{name}` placeholders. */
const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? String(vars[k]) : whole));

export function evermindLabelsFromBundle(bundle: Readonly<Record<string, string>>, prefix = 'ev.'): Partial<EvermindConsoleLabels> {
  const s = (key: string): string | undefined => bundle[`${prefix}${key}`];
  const out: Partial<EvermindConsoleLabels> = {};
  for (const k of STATIC_KEYS) {
    const v = s(k);
    if (v != null) (out as Record<string, unknown>)[k] = v;
  }
  const seeded = s('statusSeeded');
  if (seeded) out.statusSeeded = (version) => fill(seeded, { version });
  const flushedN = s('flushedN');
  if (flushedN) out.flushedN = (merged, version) => fill(flushedN, { merged, version });
  const importDone = s('importDone');
  if (importDone) out.importDone = (absorbed, version, compacted, savedKb) => fill(importDone, { absorbed, version, compacted, savedKb });
  const quarantinedHint = s('quarantinedHint');
  if (quarantinedHint) out.quarantinedHint = (reason) => fill(quarantinedHint, { reason });
  const targetSeeded = s('targetSeeded');
  if (targetSeeded) out.targetSeeded = (version) => fill(targetSeeded, { version });
  const targetProjectId = s('targetProjectId');
  if (targetProjectId) out.targetProjectId = (id) => fill(targetProjectId, { id });
  // The resolved teach outcomes — what the contribution's merge actually did.
  const taughtDistilled = s('taughtDistilled');
  if (taughtDistilled) out.taughtDistilled = (model, version) => fill(taughtDistilled, { model, version });
  const taughtSelf = s('taughtSelf');
  if (taughtSelf) out.taughtSelf = (version) => fill(taughtSelf, { version });
  const taughtTeacherFault = s('taughtTeacherFault');
  if (taughtTeacherFault) out.taughtTeacherFault = (model, reason) => fill(taughtTeacherFault, { model, reason });
  return out;
}
