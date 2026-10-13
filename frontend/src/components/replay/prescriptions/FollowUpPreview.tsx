/**
 * Follow up's human gate (PRD 33 §5.1.4, D13): the people a follow-up would
 * reach (matched contacts only — `resolveKnownContacts`; unmatched visitors are
 * counted, never listed) and the drafted first touch, shown BEFORE anyone is
 * enrolled. Nothing is sent from here: enrolling puts the chosen contacts into a
 * `sequence`, whose cadence runner sends after the seller edits the draft.
 *
 * Two ways in: "Use an existing sequence" (the workspace's sequences), or "Draft a new
 * sequence" — the API drafts 2–3 steps from the finding's cited objection, shown here
 * EDITABLE (`FollowUpSequenceDraft`) before the person creates it and enrols.
 *
 * Inline in the card (D16: no second overlay).
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayFollowUpPreviewDto, ReplayFollowUpSequenceDraftDto, ReplaySequenceChoiceDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { FollowUpSequenceDraft } from './FollowUpSequenceDraft';

/** What a confirm enrols into: an existing sequence, or a new one created from the edited draft. */
export type FollowUpEnrolInput =
  | { sequenceObjectId: string; contactIds: string[] }
  | { newSequence: ReplayFollowUpSequenceDraftDto; contactIds: string[] };

type SequenceMode = 'existing' | 'new';
const SEQUENCE_MODES: readonly SequenceMode[] = ['existing', 'new'];

/** A draft a person can confirm: a name and at least one step with a subject and a body. */
function draftReady(draft: ReplayFollowUpSequenceDraftDto | null): draft is ReplayFollowUpSequenceDraftDto {
  return !!draft && draft.name.trim() !== '' && draft.steps.some((step) => step.subject.trim() !== '' && step.body.trim() !== '');
}

export interface FollowUpPreviewProps {
  siteId: string;
  preview: ReplayFollowUpPreviewDto;
  /** The sequence this fix already enrols into, if any. */
  sequenceObjectId: string | null;
  busy: boolean;
  /** Ask the API for a drafted new sequence (the preview comes back with `draftSequence`). */
  onDraftSequence: () => void;
  onEnrol: (input: FollowUpEnrolInput) => void;
  onCancel: () => void;
}

export function FollowUpPreview({ siteId, preview, sequenceObjectId, busy, onDraftSequence, onEnrol, onCancel }: FollowUpPreviewProps) {
  const t = useTranslations('replay.prescription.followUp');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(preview.matched.map((c) => c.contactId)));
  const [sequenceId, setSequenceId] = useState<string | null>(sequenceObjectId);
  // null = not read yet.
  const [sequences, setSequences] = useState<ReplaySequenceChoiceDto[] | null>(null);
  const [mode, setMode] = useState<SequenceMode>('existing');
  // The person's edit of the API's draft; reset whenever a new draft arrives.
  const [draft, setDraft] = useState<ReplayFollowUpSequenceDraftDto | null>(preview.draftSequence ?? null);
  useEffect(() => { setDraft(preview.draftSequence ?? null); }, [preview.draftSequence]);
  useEffect(() => {
    let live = true;
    replayApi.listSequences(siteId)
      .then((found) => { if (live) setSequences(found); })
      .catch(() => { if (live) setSequences([]); });
    return () => { live = false; };
  }, [siteId]);
  const toggle = (contactId: string, on: boolean) => setChosen((current) => {
    const next = new Set(current);
    if (on) next.add(contactId); else next.delete(contactId);
    return next;
  });
  const chooseMode = (next: SequenceMode) => {
    setMode(next);
    // The draft is one model call, made only when a person asks for it.
    if (next === 'new' && !preview.draftSequence && !busy) onDraftSequence();
  };
  const target = mode === 'new' ? (draftReady(draft) ? draft : null) : sequenceId;
  const canEnrol = !busy && chosen.size > 0 && target !== null;
  const enrol = () => {
    const contactIds = [...chosen];
    if (mode === 'new' && draftReady(draft)) onEnrol({ newSequence: draft, contactIds });
    else if (mode === 'existing' && sequenceId) onEnrol({ sequenceObjectId: sequenceId, contactIds });
  };

  return (
    <section
      aria-label={t('title')}
      data-testid="follow-up-preview"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', minWidth: 0 }}
    >
      <strong style={{ fontSize: 'var(--font-size-small)' }}>{t('title')}</strong>
      {preview.matched.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('none')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', maxHeight: 220, overflowY: 'auto' }}>
          {preview.matched.map((contact) => (
            <li key={contact.contactId}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, overflowWrap: 'anywhere' }}>
                <input
                  type="checkbox"
                  checked={chosen.has(contact.contactId)}
                  aria-label={t('contactAria', { name: contact.name || contact.email })}
                  onChange={(event) => toggle(contact.contactId, event.currentTarget.checked)}
                />
                <span>{contact.name || contact.email}</span>
                {contact.name && <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{contact.email}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {preview.unmatched > 0 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('unmatched', { count: preview.unmatched })}</p>
      )}
      {preview.enrolled > 0 && (
        <p role="status" style={{ margin: 0, color: 'var(--success)', fontSize: 'var(--font-size-small)' }}>{t('enrolled', { count: preview.enrolled })}</p>
      )}
      <div role="radiogroup" aria-label={t('modeLabel')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {SEQUENCE_MODES.map((option) => (
          <label key={option} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', minHeight: 44 }}>
            <input
              type="radio"
              name={`follow-up-mode-${siteId}`}
              value={option}
              checked={mode === option}
              onChange={() => chooseMode(option)}
            />
            <span>{t(option === 'new' ? 'modeNew' : 'modeExisting')}</span>
          </label>
        ))}
      </div>
      {mode === 'existing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
          <strong style={{ fontSize: 'var(--font-size-small)' }}>{t('draftTitle')}</strong>
          <p style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{preview.draft.subject}</p>
          <p data-testid="follow-up-draft" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-primary)' }}>{preview.draft.body}</p>
        </div>
      )}
      {mode === 'new' ? (
        draft ? (
          <FollowUpSequenceDraft draft={draft} onChange={setDraft} disabled={busy} />
        ) : busy ? (
          <p role="status" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('newSequence.drafting')}</p>
        ) : (
          <button type="button" className="btn-secondary" style={{ minHeight: 44, alignSelf: 'flex-start' }} onClick={onDraftSequence}>
            {t('newSequence.retry')}
          </button>
        )
      ) : sequences !== null && sequences.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('noSequences')}</p>
      ) : (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--font-size-small)' }}>{t('sequenceLabel')}</span>
          <select
            className="input"
            value={sequenceId ?? ''}
            disabled={sequences === null}
            onChange={(event) => setSequenceId(event.currentTarget.value || null)}
            style={{ minHeight: 44 }}
          >
            <option value="">{sequences === null ? t('sequencesLoading') : t('sequenceChoose')}</option>
            {(sequences ?? []).map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.name}</option>)}
          </select>
        </label>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn-primary"
          disabled={!canEnrol}
          style={{ minHeight: 44 }}
          onClick={enrol}
        >
          {t(mode === 'new' ? 'createAndEnrol' : 'enrol', { count: chosen.size })}
        </button>
        <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={onCancel}>{t('cancel')}</button>
      </div>
    </section>
  );
}
