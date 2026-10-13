/**
 * A fix card's actions (PRD 33 §5.1.4, D13): one button per entry of the DTO's
 * `next`, drawn from `PRESCRIPTION_ACTION_UI` — no branch per action. The
 * registry's `gate` decides what happens between the press and the POST:
 *
 *   none     the POST;
 *   reason   an inline reason field (Dismiss) — required, in the card (D16);
 *   preview  `follow-up` without `confirm` → `FollowUpPreview` → enrol on confirm;
 *   confirm  `useConfirm` first (Start test, Publish preview, Revert).
 *
 * Writes are MANAGER (`requireRole(MANAGER)` on every POST) — the group sits in
 * ONE `RoleGate`, disabled with the role hint for everyone else.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  ReplayFollowUpPreviewDto,
  ReplayPrescriptionActionInput,
  ReplayPrescriptionActionResultDto,
  ReplayPrescriptionDto,
  ReplayPrescriptionRouteAction,
} from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useConfirm } from '@/components/ConfirmProvider';
import { RoleGate } from '@/components/RoleGate';
import { Icon } from '@/components/ui/Icon';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { FollowUpPreview } from './FollowUpPreview';
import { offeredActions, PRESCRIPTION_ACTION_UI } from './prescriptionActionUi';

export interface PrescriptionActionsProps {
  siteId: string;
  prescription: ReplayPrescriptionDto;
  onChanged: (prescription: ReplayPrescriptionDto) => void;
  /** Narrow to these actions (the release report offers Revert only). */
  only?: readonly ReplayPrescriptionRouteAction[];
  compact?: boolean;
}

type Gate = { kind: 'reason' } | { kind: 'preview'; preview: ReplayFollowUpPreviewDto } | null;

const TONE_CLASS = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost' } as const;

/** What an action's answer says to the reader, as a `replay.prescription.result` key + values. */
function resultNote(result: ReplayPrescriptionActionResultDto): { key: string; values: Record<string, string | number> } {
  if (result.refusal) return { key: 'refusal', values: { reason: result.refusal } };
  if (result.executionId != null) return { key: 'run', values: { taskId: result.taskId ?? '' } };
  if (result.taskId != null) return { key: 'ticket', values: { taskId: result.taskId } };
  if (result.testId != null) return { key: 'test', values: { testId: result.testId } };
  if (result.followUp && result.followUp.enrolled > 0) return { key: 'enrolled', values: { count: result.followUp.enrolled } };
  return { key: 'done', values: {} };
}

export function PrescriptionActions({ siteId, prescription, onChanged, only, compact = false }: PrescriptionActionsProps) {
  const t = useTranslations('replay.prescription');
  const confirm = useConfirm();
  const errorText = useErrorText();
  const projectScope = useOptionalProjectScope();
  const [busy, setBusy] = useState<ReplayPrescriptionRouteAction | null>(null);
  const [gate, setGate] = useState<Gate>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState<{ key: string; values: Record<string, string | number> } | null>(null);
  const [projectId, setProjectId] = useState<number | null>(projectScope?.currentProjectId ?? null);
  const offered = offeredActions(prescription.next, only);
  if (offered.length === 0) return null;
  const needsProject = offered.some(({ ui }) => ui.project);
  const projects = projectScope?.projects ?? [];

  const run = async (action: ReplayPrescriptionRouteAction, input: ReplayPrescriptionActionInput = {}) => {
    setBusy(action);
    setError('');
    setNote(null);
    try {
      const body = PRESCRIPTION_ACTION_UI[action].project && projectId != null ? { ...input, projectId } : input;
      const result = await replayApi.actOnPrescription(siteId, prescription.id, action, body);
      if (action === 'follow-up' && input.confirm !== true && result.followUp) {
        setGate({ kind: 'preview', preview: result.followUp });
        return;
      }
      setGate(null);
      setReason('');
      setNote(resultNote(result));
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
          preview={gate.preview}
          sequenceObjectId={prescription.refs.sequenceObjectId}
          busy={busy !== null}
          onEnrol={(input) => void run('follow-up', { confirm: true, ...input })}
          onCancel={() => setGate(null)}
        />
      )}

      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{error}</p>}
      {note && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere' }}>{t(`result.${note.key}`, note.values)}</p>}
    </div>
  );
}
