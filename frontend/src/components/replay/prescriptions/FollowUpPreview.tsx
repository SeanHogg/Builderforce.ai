/**
 * Follow up's human gate (PRD 33 §5.1.4, D13): the people a follow-up would
 * reach (matched contacts only — `resolveKnownContacts`; unmatched visitors are
 * counted, never listed) and the drafted first touch, shown BEFORE anyone is
 * enrolled. Nothing is sent from here: enrolling puts the chosen contacts into a
 * `sequence`, whose cadence runner sends after the seller edits the draft.
 *
 * Inline in the card (D16: no second overlay).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayFollowUpPreviewDto } from '@builderforce/interaction-contract';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A pasted sequence card link or its id → the id (the last uuid in the text). */
export function sequenceIdFrom(text: string): string | null {
  const all = text.match(new RegExp(UUID.source, 'gi'));
  return all && all.length > 0 ? all[all.length - 1]!.toLowerCase() : null;
}

export interface FollowUpPreviewProps {
  preview: ReplayFollowUpPreviewDto;
  /** The sequence this fix already enrols into, if any. */
  sequenceObjectId: string | null;
  busy: boolean;
  onEnrol: (input: { sequenceObjectId: string; contactIds: string[] }) => void;
  onCancel: () => void;
}

export function FollowUpPreview({ preview, sequenceObjectId, busy, onEnrol, onCancel }: FollowUpPreviewProps) {
  const t = useTranslations('replay.prescription.followUp');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(preview.matched.map((c) => c.contactId)));
  const [sequenceText, setSequenceText] = useState(sequenceObjectId ?? '');
  const sequenceId = sequenceIdFrom(sequenceText);
  const toggle = (contactId: string, on: boolean) => setChosen((current) => {
    const next = new Set(current);
    if (on) next.add(contactId); else next.delete(contactId);
    return next;
  });
  const canEnrol = !busy && chosen.size > 0 && sequenceId !== null;

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
        <strong style={{ fontSize: 'var(--font-size-small)' }}>{t('draftTitle')}</strong>
        <p style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{preview.draft.subject}</p>
        <p data-testid="follow-up-draft" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-primary)' }}>{preview.draft.body}</p>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--font-size-small)' }}>{t('sequenceLabel')}</span>
        <input
          className="input"
          value={sequenceText}
          placeholder={t('sequenceHint')}
          onChange={(event) => setSequenceText(event.currentTarget.value)}
          style={{ minHeight: 44 }}
        />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn-primary"
          disabled={!canEnrol}
          style={{ minHeight: 44 }}
          onClick={() => { if (sequenceId) onEnrol({ sequenceObjectId: sequenceId, contactIds: [...chosen] }); }}
        >
          {t('enrol', { count: chosen.size })}
        </button>
        <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={onCancel}>{t('cancel')}</button>
      </div>
    </section>
  );
}
