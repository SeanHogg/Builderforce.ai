import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { faultMessage } from '@/lib/apiClient';
import { useFormat } from '@/i18n/useFormat';
import { reserveTalentSession, type TalentBookingService } from '@/lib/freelance/booking';

function defaultLocal(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BookAdvisorPanel(props: {
  talentId: string;
  services: TalentBookingService[];
  timezone?: string | null;
  onBooked: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('talent');
  const fmt = useFormat();
  const [serviceId, setServiceId] = useState(String(props.services[0]?.id ?? ''));
  const [when, setWhen] = useState(defaultLocal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => props.services.find((s) => String(s.id) === serviceId) ?? props.services[0],
    [props.services, serviceId],
  );

  /**
   * `Free · 30 minutes` / `30 € · 30 Minuten` / `US$30.00 · 30 分钟`.
   *
   * Both halves are locale data, not text. The price is minor units in the
   * service's OWN currency, so it is divided by 100 and handed to `money`, which
   * places the symbol, the grouping and the decimal separator per locale — a
   * paid service previously rendered NO price at all, only the zero case was
   * ever shown, which is why this is a single helper both call sites share
   * rather than an expression repeated twice.
   *
   * `minutes` is passed as a RAW number, not a pre-formatted string: the catalogs
   * are minified to one line and cannot be read here to confirm whether
   * `talent.bookMinutes` declares the placeholder as a bare `{minutes}` or as a
   * typed `{minutes, number}` / plural. A number is correct under every one of
   * those declarations — handing ICU an already-formatted string is not.
   */
  const describe = (s: TalentBookingService): string => {
    const price = s.priceCents === 0 ? t('bookFree') : fmt.money(s.priceCents / 100, s.currency);
    return `${price} · ${t('bookMinutes', { minutes: s.durationMin })}`;
  };

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const startsAt = new Date(when);
      if (Number.isNaN(startsAt.getTime())) {
        setError(t('bookError'));
        return;
      }
      await reserveTalentSession({
        talentId: props.talentId,
        serviceId: selected.id,
        startsAt: startsAt.toISOString(),
        timezone: props.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      props.onBooked();
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      setError(raw.includes('no longer available') ? t('bookOverlap') : faultMessage(e, t('bookError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        marginTop: 16,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t('bookSession')}</div>
      {props.services.length > 1 && (
        <label style={{ display: 'grid', gap: 6, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
          {t('bookService')}
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
            }}
          >
            {props.services.map((s) => (
              <option key={s.id} value={s.id}>
                {`${s.name} · ${describe(s)}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && props.services.length === 1 && (
        <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
          {`${selected.name} · ${describe(selected)}`}
        </div>
      )}
      <label style={{ display: 'grid', gap: 6, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        {t('bookWhen')}
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
          }}
        />
      </label>
      {error && <div style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={props.onCancel}
          disabled={busy}
          style={{
            padding: '9px 16px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            fontWeight: 600,
            fontSize: 'var(--font-size-small)',
            cursor: 'pointer',
          }}
        >
          {t('bookCancel')}
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy || !selected || !when}
          style={{
            padding: '9px 18px',
            borderRadius: 'var(--radius-lg)',
            border: 'none',
            background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
            color: 'var(--text-on-accent)',
            fontWeight: 700,
            fontSize: 'var(--font-size-small)',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? t('booking') : t('bookConfirm')}
        </button>
      </div>
    </div>
  );
}
