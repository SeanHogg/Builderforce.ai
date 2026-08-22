/*
 * No `'use client'` here on purpose — see the note at the top of `Calendar.tsx`. Its only
 * consumer is that component, which is already inside a client boundary.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isAllDayValue, type CalendarEvent } from '@builderforce/creation-canvas-contract';
import { useFormat } from '@/i18n/useFormat';
import type { CalendarEventDraft } from '@/lib/calendar/calendarSources';
import styles from './Calendar.module.css';

export interface CalendarEventDetailProps {
  /** The event being read. Absent when this is a new one. */
  event?: CalendarEvent;
  /** Seed values for a new event. Absent when an existing one is open. */
  draft?: CalendarEventDraft;
  onClose: () => void;
  onOpenSource?: () => void;
  onCreate?: (draft: CalendarEventDraft) => void | Promise<void>;
  onUpdate?: (event: CalendarEvent, patch: CalendarEventDraft) => void | Promise<void>;
  onDelete?: (event: CalendarEvent) => void | Promise<void>;
}

/**
 * The detail panel — a modal WITHIN THE CALENDAR, never over the page.
 *
 * ── WHY IT IS SCOPED TO ITS PARENT AND NOT PORTALLED ─────────────────────────────
 * This component is mounted inside a ~340px card as often as inside a full-screen
 * surface. A page-level dialog thrown from a card would cover the board the card sits
 * on, which is a calendar deciding something about a page it knows nothing about. It is
 * `position: absolute` inside the calendar's own bounds instead, so it scales with
 * whatever is hosting it and can never escape it.
 *
 * It is also why this does not reach for the app's slide-out panel: that primitive
 * belongs to a page shell, and the whole point of this component is that it is
 * self-contained enough to render anywhere something has dates.
 *
 * ── READ FIRST, EDIT ON PURPOSE ──────────────────────────────────────────────────
 * Opening an event shows it. Editing is a deliberate second act, and it is offered only
 * when the SOURCE can actually write — `onUpdate` absent means a read-only reading (a
 * connected Google calendar, a derived rollup) and the panel says so instead of
 * offering a control that would fail. A new event opens straight in the form, because
 * there is nothing to read yet.
 */
export function CalendarEventDetail({
  event, draft, onClose, onOpenSource, onCreate, onUpdate, onDelete,
}: CalendarEventDetailProps) {
  const t = useTranslations('calendar');
  const fmt = useFormat();

  const editable = Boolean(event ? onUpdate && !event.readOnly : onCreate);
  const [editing, setEditing] = useState(!event);
  const [values, setValues] = useState<CalendarEventDraft>(() => draft ?? draftFromEvent(event));
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // The panel takes focus when it opens, so the keyboard lands in it rather than on the
  // day cell behind it — and so Escape (handled by the calendar) reaches the right tree.
  useEffect(() => { closeRef.current?.focus(); }, []);

  // A refreshed source replaces the event object. Re-seed the form ONLY while not
  // editing: overwriting half-typed values because a poll returned would lose the edit.
  useEffect(() => {
    if (!event || editing) return;
    setValues(draftFromEvent(event));
  }, [event, editing]);

  const when = useMemo(() => {
    if (!event) return '';
    if (event.allDay) {
      const endsLater = event.endISO && new Date(event.endISO).getTime() - new Date(event.startISO).getTime() > 86_400_000;
      return endsLater ? `${fmt.date(event.startISO)} – ${fmt.date(event.endISO!)}` : fmt.dateLong(event.startISO);
    }
    return event.endISO
      ? `${fmt.dateTime(event.startISO)} – ${fmt.time(event.endISO)}`
      : fmt.dateTime(event.startISO);
  }, [event, fmt]);

  const run = async (action: () => void | Promise<void>) => {
    setBusy(true);
    try { await action(); onClose(); } finally { setBusy(false); }
  };

  return (
    <div className={styles.detail} role="dialog" aria-modal="false" aria-label={t('detailLabel')}>
      <header className={styles.detailHeader}>
        <b>{editing ? (event ? t('editTitle') : t('newTitle')) : (event?.subject || t('untitled'))}</b>
        <button ref={closeRef} type="button" onClick={onClose} aria-label={t('close')}>×</button>
      </header>

      {!editing && event && (
        <div className={styles.detailBody}>
          <p className={styles.detailWhen}>{when}</p>
          {event.category && <span className={styles.detailChip} style={{ ['--event-color' as string]: 'var(--accent)' }}>{event.category}</span>}
          {event.location && <p className={styles.detailMeta}>{event.location}</p>}
          {event.details && <p className={styles.detailText}>{event.details}</p>}
          {!event.details && !event.location && <p className={styles.detailMeta}>{t('noDetails')}</p>}
          {event.readOnly && <p className={styles.detailMeta}>{t('readOnly')}</p>}
          <div className={styles.detailActions}>
            {onOpenSource && <button type="button" onClick={onOpenSource}>{t('openSource')}</button>}
            {event.url && <a href={event.url} target="_blank" rel="noreferrer">{t('openLink')}</a>}
            {editable && <button type="button" onClick={() => setEditing(true)}>{t('edit')}</button>}
            {onDelete && !event.readOnly && (
              confirmingDelete
                ? <button type="button" className={styles.danger} disabled={busy} onClick={() => void run(() => onDelete(event))}>{t('confirmDelete')}</button>
                : <button type="button" className={styles.danger} onClick={() => setConfirmingDelete(true)}>{t('delete')}</button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <form
          className={styles.detailBody}
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            if (event && onUpdate) void run(() => onUpdate(event, values));
            else if (!event && onCreate) void run(() => onCreate(values));
          }}
        >
          <label className={styles.field}>
            <span>{t('field.subject')}</span>
            <input
              value={values.subject}
              onChange={(changed) => setValues((current) => ({ ...current, subject: changed.target.value }))}
              placeholder={t('field.subjectPlaceholder')}
              required
              autoFocus
            />
          </label>
          <label className={styles.fieldInline}>
            <input
              type="checkbox"
              checked={values.allDay}
              onChange={(changed) => setValues((current) => ({
                ...current,
                allDay: changed.target.checked,
                startISO: changed.target.checked
                  ? current.startISO.slice(0, 10)
                  : `${current.startISO.slice(0, 10)}T09:00`,
                ...(changed.target.checked ? { endISO: undefined } : {}),
              }))}
            />
            <span>{t('field.allDay')}</span>
          </label>
          <label className={styles.field}>
            <span>{t('field.starts')}</span>
            <input
              type={values.allDay ? 'date' : 'datetime-local'}
              value={values.startISO}
              onChange={(changed) => setValues((current) => ({ ...current, startISO: changed.target.value }))}
              required
            />
          </label>
          {!values.allDay && (
            <label className={styles.field}>
              <span>{t('field.ends')}</span>
              <input
                type="datetime-local"
                value={values.endISO ?? ''}
                onChange={(changed) => setValues((current) => ({ ...current, endISO: changed.target.value || undefined }))}
              />
            </label>
          )}
          <label className={styles.field}>
            <span>{t('field.details')}</span>
            <textarea
              rows={3}
              value={values.details}
              onChange={(changed) => setValues((current) => ({ ...current, details: changed.target.value }))}
              placeholder={t('field.detailsPlaceholder')}
            />
          </label>
          <label className={styles.field}>
            <span>{t('field.category')}</span>
            <input
              value={values.category ?? ''}
              onChange={(changed) => setValues((current) => ({ ...current, category: changed.target.value || undefined }))}
              placeholder={t('field.categoryPlaceholder')}
            />
          </label>
          <div className={styles.detailActions}>
            <button type="submit" className={styles.primary} disabled={busy || !values.subject.trim()}>{t('save')}</button>
            <button type="button" onClick={() => (event ? setEditing(false) : onClose())}>{t('cancel')}</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** An event as form values, in the reader's own zone. The inverse conversion — form
 *  values back to a stored date — belongs to the SOURCE, because only it knows whether
 *  it stores an instant, a date string, or minutes into a working day. */
function draftFromEvent(event?: CalendarEvent): CalendarEventDraft {
  if (!event) {
    return { subject: '', details: '', startISO: new Date().toISOString().slice(0, 10), allDay: true };
  }
  const allDay = Boolean(event.allDay ?? isAllDayValue(event.startISO));
  return {
    subject: event.subject,
    details: event.details ?? '',
    startISO: allDay ? event.startISO.slice(0, 10) : localInputValue(event.startISO),
    ...(event.endISO && !allDay ? { endISO: localInputValue(event.endISO) } : {}),
    allDay,
    ...(event.category ? { category: event.category } : {}),
    ...(event.location ? { location: event.location } : {}),
  };
}

/** An instant as `YYYY-MM-DDTHH:mm` in the reader's zone — what `datetime-local` holds.
 *  `toISOString()` would render it in UTC, which is the offset bug this avoids. */
function localInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
