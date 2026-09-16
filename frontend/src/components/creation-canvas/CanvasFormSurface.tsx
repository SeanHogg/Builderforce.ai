'use client';

/**
 * THE FORM SURFACE — publish, collect, close, and read the tally.
 *
 * Twin of `CanvasFacilitateSurface`: the card is the draft, this is the room
 * the form is RUN from. Publish and close go through `formPublishBody` so Brain
 * and a person cannot disagree about what the card's `questions` mean. The tally
 * is `summarizeForm` on a poll, written back onto the card so the board and this
 * surface cannot drift.
 *
 * Audience is the form's own vocabulary (`anyoneWithLink | workspace |
 * namedRecipients`). Named recipients can be filled from a marketing audience
 * (including "add my CRM contacts") — that path writes `source: crm` through
 * the existing audience-member store; it does not invent a second one.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  closeForm, publishForm, summarizeForm, type FormSummary,
} from '@/lib/founderOpsApi';
import { growthApi, type Audience } from '@/lib/growthApi';
import {
  FORM_AUDIENCE_VALUES, formAudienceOf, formJoinUrl, formPublishBody,
  readFormQuestions, readFormRecipients, type FormCardData,
} from '@/lib/formObject';
import { usePolledResource } from '@/hooks/usePolledResource';
import type { CreationNodeData } from './types';
import styles from './CanvasFormSurface.module.css';

const REFRESH_MS = 4000;

export interface CanvasFormSurfaceProps {
  data: CreationNodeData;
  objectId: string;
  onExit: () => void;
  /** Absent when the viewer cannot edit this canvas. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}

export function CanvasFormSurface({ data, objectId, onExit, onEdit }: CanvasFormSurfaceProps) {
  const t = useTranslations('form');
  const card = data as FormCardData & CreationNodeData;
  const questionSetId = typeof card.questionSetId === 'string' ? card.questionSetId : '';
  const shareUrl = typeof card.shareUrl === 'string' && card.shareUrl
    ? card.shareUrl
    : typeof card.joinUrl === 'string' ? card.joinUrl : '';
  const audience = formAudienceOf(card);
  const questions = readFormQuestions(card.questions);
  const recipients = readFormRecipients(card.recipients);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [audienceId, setAudienceId] = useState<number | ''>('');

  const writeBack = useCallback((patch: Partial<CreationNodeData>) => {
    onEdit?.(patch);
  }, [onEdit]);

  const read = useCallback(async (signal: AbortSignal) => {
    if (!questionSetId) return null;
    const { summary } = await summarizeForm(questionSetId);
    if (signal.aborted) return summary;
    if (!summary) return null;
    const invited = summary.invitedCount;
    const responded = summary.respondedCount;
    writeBack({
      responseCount: summary.submissionCount,
      completionRate: invited > 0 ? responded / invited : 0,
      status: summary.status,
      ...(summary.slug ? { shareUrl: formJoinUrl(summary.slug) } : {}),
    } as Partial<CreationNodeData>);
    return summary;
  }, [questionSetId, writeBack]);

  const tally = usePolledResource(read, { intervalMs: REFRESH_MS, enabled: !!questionSetId, immediate: true });
  const summary: FormSummary | null = tally.data ?? null;

  useEffect(() => {
    if (!onEdit) return;
    void growthApi.listAudiences()
      .then(({ audiences: list }) => {
        setAudiences(list);
        if (list[0] && audienceId === '') setAudienceId(list[0].id);
      })
      .catch(() => { /* picker stays empty; publish still works without CRM */ });
  }, [onEdit]); // eslint-disable-line react-hooks/exhaustive-deps -- load once per edit session

  const publish = async () => {
    if (!onEdit) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await publishForm(formPublishBody(card, objectId));
      const url = formJoinUrl(result.slug);
      onEdit({
        questionSetId: result.questionSetId,
        shareUrl: url,
        joinUrl: url,
        status: result.status,
      } as Partial<CreationNodeData>);
      setNotice(t('noticePublished'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('publishFailed'));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!onEdit || !questionSetId) return;
    setBusy(true);
    setNotice(null);
    try {
      await closeForm(questionSetId);
      onEdit({ status: 'closed' } as Partial<CreationNodeData>);
      setNotice(t('noticeClosed'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('closeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const addFromCrm = async () => {
    if (!onEdit) return;
    setBusy(true);
    setNotice(null);
    try {
      let id = typeof audienceId === 'number' ? audienceId : 0;
      if (!id) {
        const created = await growthApi.createAudience({
          name: typeof card.title === 'string' && card.title.trim() ? String(card.title) : t('untitled'),
        });
        id = created.id;
        setAudiences((current) => [...current, created]);
        setAudienceId(id);
      }
      const result = await growthApi.addMembersFromCrm(id);
      const next = result.members.length
        ? result.members.map((member) => member.email)
        : recipients.map((member) => member.email);
      if (result.members.length) {
        onEdit({
          audience: 'namedRecipients',
          recipients: next,
        } as Partial<CreationNodeData>);
      }
      setNotice(t('noticeCrmImported', { added: result.added, updated: result.updated, rejected: result.rejected }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('crmFailed'));
    } finally {
      setBusy(false);
    }
  };

  const status = summary?.status
    ?? (typeof card.status === 'string' ? card.status : 'draft');
  const responseCount = summary?.submissionCount
    ?? (typeof card.responseCount === 'number' ? card.responseCount : 0);

  return (
    <section
      className={styles.surface}
      data-testid="canvas-form-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <header className={styles.bar}>
        <div className={styles.identity}>
          <h2 className={styles.title}>{typeof card.title === 'string' && card.title.trim() ? card.title : t('untitled')}</h2>
          <p className={styles.status} data-status={status}>{t(`status.${status}`, { defaultMessage: status })}</p>
        </div>
        <div className={styles.actions}>
          {onEdit && !questionSetId && (
            <button type="button" className={styles.primary} disabled={busy || questions.length === 0} onClick={() => void publish()}>
              {t('publish')}
            </button>
          )}
          {onEdit && questionSetId && status !== 'closed' && (
            <button type="button" className={styles.danger} disabled={busy} onClick={() => void close()}>
              {t('close')}
            </button>
          )}
          <button type="button" className={styles.ghost} onClick={onExit}>{t('exit')}</button>
        </div>
      </header>

      <div className={styles.body}>
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {!questionSetId && <p className={styles.hint}>{onEdit ? t('unpublishedHint') : t('readOnlyHint')}</p>}

        {shareUrl && (
          <p className={styles.share}>
            <span>{t('shareUrl')}</span>
            <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
          </p>
        )}

        <dl className={styles.tally}>
          <div>
            <dt>{t('responseCount')}</dt>
            <dd>{responseCount}</dd>
          </div>
          <div>
            <dt>{t('invitedCount')}</dt>
            <dd>{summary?.invitedCount ?? recipients.length}</dd>
          </div>
          <div>
            <dt>{t('respondedCount')}</dt>
            <dd>{summary?.respondedCount ?? 0}</dd>
          </div>
        </dl>

        {onEdit && (
          <fieldset className={styles.audience} disabled={busy}>
            <legend>{t('audienceLegend')}</legend>
            <label>
              {t('audience')}
              <select
                value={audience}
                onChange={(event) => onEdit({ audience: event.target.value } as Partial<CreationNodeData>)}
              >
                {FORM_AUDIENCE_VALUES.map((value) => (
                  <option key={value} value={value}>{t(`audienceOption.${value}`)}</option>
                ))}
              </select>
            </label>
            {audience === 'namedRecipients' && (
              <label>
                {t('recipients')}
                <textarea
                  value={recipients.map((row) => row.email).join('\n')}
                  onChange={(event) => onEdit({ recipients: event.target.value.split(/\n+/).map((line) => line.trim()).filter(Boolean) } as Partial<CreationNodeData>)}
                  rows={4}
                />
              </label>
            )}
            <div className={styles.crm}>
              {audiences.length > 0 && (
                <label>
                  {t('marketingAudience')}
                  <select
                    value={audienceId === '' ? '' : String(audienceId)}
                    onChange={(event) => setAudienceId(event.target.value ? Number(event.target.value) : '')}
                  >
                    <option value="">{t('newAudience')}</option>
                    {audiences.map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" className={styles.secondary} onClick={() => void addFromCrm()}>
                {t('addFromCrm')}
              </button>
            </div>
          </fieldset>
        )}

        <ol className={styles.questions}>
          {questions.map((question) => (
            <li key={question.id}>
              <strong>{question.label}</strong>
              <span>{question.type}{question.required ? ` · ${t('required')}` : ''}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
