'use client';

/**
 * Write a platform broadcast — the ONE composer.
 *
 * Two surfaces open it: the Broadcasts panel (author or edit a campaign) and the
 * Sessions panel's "message this visitor" action. They are the same form, because
 * they are the same object: a message aimed at one visitor and a message aimed at
 * every unconverted guest differ by an audience field, not by a workflow. Two
 * forms would mean two places to add a tone, a schedule or a CTA — and one of them
 * would be forgotten.
 *
 * A slide-out, not a modal: this is an editor, and the app reserves centred modals
 * for terminal destructive approvals.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminBroadcast, type AdminBroadcastInput } from '@/lib/adminApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { AdminError, errText } from '@/components/admin/adminShared';

type Tone = AdminBroadcast['tone'];
type Status = AdminBroadcast['status'];
type Scope = AdminBroadcast['audience']['scope'];

const TONES: Tone[] = ['info', 'success', 'warning', 'critical'];
const STATUSES: Status[] = ['draft', 'live', 'archived'];
const SCOPES: Scope[] = ['all', 'guest', 'registered', 'paid'];

export interface BroadcastComposerProps {
  open: boolean;
  onClose: () => void;
  /** Editing an existing broadcast, or null to author a new one. */
  broadcast?: AdminBroadcast | null;
  /** Pre-aim it at one visitor — the Sessions panel's entry point. */
  targetVisitorId?: string | null;
  onSaved: () => void;
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` and gives back the same; the API
 *  speaks ISO. One conversion each way, here, so no caller has to know. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function BroadcastComposer({
  open, onClose, broadcast = null, targetVisitorId = null, onSaved,
}: BroadcastComposerProps) {
  const t = useTranslations('admin.broadcasts');

  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<Tone>('info');
  const [status, setStatus] = useState<Status>('draft');
  const [scope, setScope] = useState<Scope>('all');
  const [minPrompts, setMinPrompts] = useState(0);
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaHref, setCtaHref] = useState('');
  const [dismissible, setDismissible] = useState(true);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset from the subject every time the drawer opens, so a previous edit can
  // never bleed into the next one.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setMessage(broadcast?.message ?? '');
    setTone(broadcast?.tone ?? 'info');
    // A message aimed at one visitor is written to be sent, not filed.
    setStatus(broadcast?.status ?? (targetVisitorId ? 'live' : 'draft'));
    setScope(broadcast?.audience.scope ?? 'all');
    setMinPrompts(broadcast?.audience.minPrompts ?? 0);
    setCtaLabel(broadcast?.ctaLabel ?? '');
    setCtaHref(broadcast?.ctaHref ?? '');
    setDismissible(broadcast?.dismissible ?? true);
    setStartsAt(toLocalInput(broadcast?.startsAt ?? null));
    setEndsAt(toLocalInput(broadcast?.endsAt ?? null));
  }, [open, broadcast, targetVisitorId]);

  const visitorIds = targetVisitorId
    ? [targetVisitorId]
    : (broadcast?.audience.visitorIds ?? []);

  async function save() {
    if (!message.trim()) { setError(t('messageRequired')); return; }
    setSaving(true);
    setError(null);
    const input: AdminBroadcastInput = {
      message: message.trim(),
      tone,
      status,
      ctaLabel: ctaLabel.trim() || null,
      ctaHref: ctaHref.trim() || null,
      dismissible,
      audience: { scope, visitorIds, minPrompts },
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
    };
    try {
      if (broadcast) await adminApi.updateBroadcast(broadcast.id, input);
      else await adminApi.createBroadcast(input);
      onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  }

  const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
  const label: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={broadcast ? t('editTitle') : t('composeTitle')}
      widthStorageKey="broadcast-composer"
      headerActions={
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? t('saving') : t('save')}
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AdminError message={error} />

        {targetVisitorId && (
          <p className="text-muted" style={{ fontSize: 12, margin: 0, overflowWrap: 'anywhere' }}>
            {t('aimedAtVisitor', { visitorId: targetVisitorId })}
          </p>
        )}

        <div style={field}>
          <label style={label} htmlFor="broadcast-message">{t('messageLabel')}</label>
          <textarea
            id="broadcast-message"
            className="input"
            rows={3}
            maxLength={500}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('messagePlaceholder')}
          />
          <span className="text-muted" style={{ fontSize: 11 }}>{t('messageCounter', { used: message.length })}</span>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ ...field, flex: '1 1 140px' }}>
            <label style={label} htmlFor="broadcast-tone">{t('toneLabel')}</label>
            <select id="broadcast-tone" className="input" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
              {TONES.map((value) => <option key={value} value={value}>{t(`tone.${value}`)}</option>)}
            </select>
          </div>
          <div style={{ ...field, flex: '1 1 140px' }}>
            <label style={label} htmlFor="broadcast-status">{t('statusLabel')}</label>
            <select id="broadcast-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ ...field, flex: '1 1 160px' }}>
            <label style={label} htmlFor="broadcast-scope">{t('scopeLabel')}</label>
            <select
              id="broadcast-scope"
              className="input"
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              disabled={!!targetVisitorId}
            >
              {SCOPES.map((value) => <option key={value} value={value}>{t(`scope.${value}`)}</option>)}
            </select>
          </div>
          <div style={{ ...field, flex: '1 1 160px' }}>
            <label style={label} htmlFor="broadcast-min-prompts">{t('minPromptsLabel')}</label>
            <input
              id="broadcast-min-prompts"
              className="input"
              type="number"
              min={0}
              value={minPrompts}
              onChange={(e) => setMinPrompts(Math.max(0, Number(e.target.value) || 0))}
            />
            <span className="text-muted" style={{ fontSize: 11 }}>{t('minPromptsHint')}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ ...field, flex: '1 1 160px' }}>
            <label style={label} htmlFor="broadcast-cta-label">{t('ctaLabelLabel')}</label>
            <input id="broadcast-cta-label" className="input" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
          </div>
          <div style={{ ...field, flex: '2 1 220px' }}>
            <label style={label} htmlFor="broadcast-cta-href">{t('ctaHrefLabel')}</label>
            <input id="broadcast-cta-href" className="input" value={ctaHref} onChange={(e) => setCtaHref(e.target.value)} placeholder="/pricing" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ ...field, flex: '1 1 180px' }}>
            <label style={label} htmlFor="broadcast-starts">{t('startsAtLabel')}</label>
            <input id="broadcast-starts" className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div style={{ ...field, flex: '1 1 180px' }}>
            <label style={label} htmlFor="broadcast-ends">{t('endsAtLabel')}</label>
            <input id="broadcast-ends" className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={dismissible} onChange={(e) => setDismissible(e.target.checked)} />
          {t('dismissibleLabel')}
        </label>
      </div>
    </SlideOutPanel>
  );
}
