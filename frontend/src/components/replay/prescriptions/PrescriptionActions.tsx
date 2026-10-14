/**
 * A fix card's actions (PRD 33 §5.1.4, §5.2, D13): one button per entry of the
 * DTO's `next`, drawn from `PRESCRIPTION_ACTION_UI` — no branch per action. The
 * registry's `gate` decides what happens between the press and the POST:
 *
 *   none       the POST;
 *   reason     an inline reason field (Dismiss) — required, in the card (D16);
 *   preview    `follow-up` without `confirm` → `FollowUpPreview` → enrol on confirm;
 *   confirm    `useConfirm` first (Start test, Publish preview, Revert);
 *   promptTab  the `fix` kind's Prompt tab (Copy prompt: the copy there records it);
 *   audience   an inline audience switch, then the POST; the bundled prompt is shown
 *              with its Copy button (Apply to the page);
 *   composer   the POST, then its prompt + selectors go to the host's ONE composer
 *              (`ComposerBridge`) — drawn only where a bridge exists.
 *
 * Writes are MANAGER (`requireRole(MANAGER)` on every POST) — the group sits in
 * ONE `RoleGate`, disabled with the role hint for everyone else.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  ImprovementAudience,
  ReplayFollowUpPreviewDto,
  ReplayPrescriptionActionInput,
  ReplayPrescriptionDto,
  ReplayPrescriptionRouteAction,
} from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useConfirm } from '@/components/ConfirmProvider';
import { RoleGate } from '@/components/RoleGate';
import { Icon } from '@/components/ui/Icon';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';
import { composerTargets, useComposerBridge } from '@/components/insights/composerBridge';
import { CodingAgentPicker } from './CodingAgentPicker';
import { FollowUpPreview } from './FollowUpPreview';
import { ApplyPageGate, actionResultNote, type ActionNote } from './PrescriptionActionGates';
import { offeredActions, PRESCRIPTION_ACTION_UI } from './prescriptionActionUi';
import { useInsightsLevel } from './useInsightsLevel';
import { PromptBox } from '../prompt/PromptBox';

export interface PrescriptionActionsProps {
  siteId: string;
  prescription: ReplayPrescriptionDto;
  onChanged: (prescription: ReplayPrescriptionDto) => void;
  /** Narrow to these actions (the release report offers Revert only). */
  only?: readonly ReplayPrescriptionRouteAction[];
  compact?: boolean;
  /** Push onto the panel (Copy prompt opens the Prompt tab); defaults to the panel in scope, else a link. */
  push?: (level: InsightPanelLevel) => void;
}

type Gate =
  | { kind: 'reason' }
  | { kind: 'preview'; preview: ReplayFollowUpPreviewDto }
  | { kind: 'audience' }
  | { kind: 'prompt'; prompt: string }
  | null;

const TONE_CLASS = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost' } as const;

export function PrescriptionActions({ siteId, prescription, onChanged, only, compact = false, push }: PrescriptionActionsProps) {
  const t = useTranslations('replay.prescription');
  const confirm = useConfirm();
  const errorText = useErrorText();
  const projectScope = useOptionalProjectScope();
  const bridge = useComposerBridge();
  const opener = useInsightsLevel(siteId, push);
  const [busy, setBusy] = useState<ReplayPrescriptionRouteAction | null>(null);
  const [gate, setGate] = useState<Gate>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState<ActionNote | null>(null);
  const [projectId, setProjectId] = useState<number | null>(projectScope?.currentProjectId ?? null);
  const [agentRef, setAgentRef] = useState<string | null>(null);
  const offered = offeredActions(prescription.next, only, { composer: bridge !== null });
  if (offered.length === 0) return null;
  const needsProject = offered.some(({ ui }) => ui.project);
  const needsAgent = offered.some(({ ui }) => ui.agent);
  const projects = projectScope?.projects ?? [];

  const run = async (action: ReplayPrescriptionRouteAction, input: ReplayPrescriptionActionInput = {}) => {
    const ui = PRESCRIPTION_ACTION_UI[action];
    setBusy(action);
    setError('');
    setNote(null);
    try {
      const body: ReplayPrescriptionActionInput = {
        ...input,
        ...(ui.project && projectId != null ? { projectId } : {}),
        ...(ui.agent && agentRef ? { agentRef } : {}),
      };
      const result = await replayApi.actOnPrescription(siteId, prescription.id, action, body);
      if (action === 'follow-up' && input.confirm !== true && result.followUp) {
        setGate({ kind: 'preview', preview: result.followUp });
        return;
      }
      setReason('');
      if (ui.gate === 'audience' && result.prompt) setGate({ kind: 'prompt', prompt: result.prompt });
      else setGate(null);
      if (ui.gate === 'composer' && bridge && result.prompt) {
        bridge.applyToComposer({ prompt: result.prompt, targets: composerTargets(result), pagePath: prescription.pagePath ?? '/' });
      }
      setNote(actionResultNote(result, ui.gate));
      onChanged(result.prescription);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  };

  const press = async (action: ReplayPrescriptionRouteAction) => {
    const ui = PRESCRIPTION_ACTION_UI[action];
    if (ui.gate === 'reason') { setGate({ kind: 'reason' }); return; }
    if (ui.gate === 'audience') { setGate({ kind: 'audience' }); return; }
    if (ui.gate === 'promptTab') {
      const level: InsightPanelLevel = { kind: 'fix', id: prescription.id, tab: 'prompt' };
      if (opener.push) opener.push(level); else window.location.assign(opener.href(level));
      return;
    }
    if (ui.gate === 'preview') { await run(action, { confirm: false }); return; }
    if (ui.gate === 'confirm') {
      const ok = await confirm({
        title: t(`confirm.${action}.title`),
        message: t(`confirm.${action}.message`),
        confirmLabel: t(`confirm.${action}.confirm`),
        destructive: true,
      });
      if (!ok) return;
    }
    await run(action);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <RoleGate capability="insights.actOnFixes">
        <div role="group" aria-label={t('actionsAria')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', alignItems: 'center' }}>
          {offered.map(({ action, ui }) => (
            <button
              key={action}
              type="button"
              data-action={action}
              className={TONE_CLASS[ui.tone]}
              disabled={busy !== null}
              aria-busy={busy === action}
              style={{ minHeight: 44 }}
              onClick={() => void press(action)}
            >
              <Icon name={ui.icon} size={14} /> {t(`actions.${ui.labelKey}`)}
            </button>
          ))}
          {needsProject && !compact && projects.length > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-small)' }}>
              <span>{t('project.label')}</span>
              <select
                className="input"
                value={projectId ?? ''}
                onChange={(event) => setProjectId(event.currentTarget.value ? Number(event.currentTarget.value) : null)}
                style={{ minHeight: 44, maxWidth: 200 }}
              >
                <option value="">{t('project.none')}</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          )}
          {needsAgent && !compact && <CodingAgentPicker siteId={siteId} value={agentRef} onChange={setAgentRef} />}
        </div>
      </RoleGate>

      {gate?.kind === 'reason' && (
        <form
          aria-label={t('dismiss.title')}
          onSubmit={(event) => { event.preventDefault(); if (reason.trim()) void run('dismiss', { reason: reason.trim() }); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--font-size-small)' }}>{t('dismiss.reasonLabel')}</span>
            <textarea
              className="input"
              required
              rows={2}
              maxLength={2_000}
              value={reason}
              placeholder={t('dismiss.reasonPlaceholder')}
              onChange={(event) => setReason(event.currentTarget.value)}
              style={{ minHeight: 44, resize: 'vertical' }}
            />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <button type="submit" className="btn-secondary" disabled={busy !== null || !reason.trim()} style={{ minHeight: 44 }}>{t('dismiss.submit')}</button>
            <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={() => { setGate(null); setReason(''); }}>{t('dismiss.cancel')}</button>
          </div>
        </form>
      )}

      {gate?.kind === 'preview' && (
        <FollowUpPreview
          siteId={siteId}
          preview={gate.preview}
          sequenceObjectId={prescription.refs.sequenceObjectId}
          busy={busy !== null}
          onDraftSequence={() => void run('follow-up', { confirm: false, draftSequence: true })}
          onEnrol={(input) => void run('follow-up', { confirm: true, ...input })}
          onCancel={() => setGate(null)}
        />
      )}

      {gate?.kind === 'audience' && (
        <ApplyPageGate
          busy={busy !== null}
          onApply={(audience: ImprovementAudience) => void run('apply-page', { audience })}
          onCancel={() => setGate(null)}
        />
      )}

      {/* apply-page already recorded every fix it bundled: the copy records nothing more. */}
      {gate?.kind === 'prompt' && <PromptBox prompt={gate.prompt} />}

      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{error}</p>}
      {note && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere' }}>{t(`result.${note.key}`, note.values)}</p>}
    </div>
  );
}
