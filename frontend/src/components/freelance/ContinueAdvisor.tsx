import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { faultMessage } from '@/lib/apiClient';
import {
  continueAdvisorSession,
  type CompletedAdvisorSession,
} from '@/lib/freelance/continueAdvisor';

function defaultLocal(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Booking-history affordance for a completed advisor session.
 *
 * There is no booking-history page or component in the tree, so this is the
 * control a history row renders: it already knows the advisor (`advisorUserId`
 * = `host_ref`) and the service, and it books that pair again. It does not
 * search the marketplace and it does not open the talent listing.
 *
 * The continue label is a prop. Message catalogs are not part of this change,
 * so the default is a plain string; shared book keys (`bookWhen`, `bookOverlap`,
 * `bookError`, `bookCancel`, `booking`) are reused.
 */
export function ContinueAdvisor(props: {
  session: CompletedAdvisorSession;
  advisorName?: string | null;
  label?: string;
  onContinued: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('talent');
  const [when, setWhen] = useState(defaultLocal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = props.label ?? 'Continue with this advisor';

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const startsAt = new Date(when);
      if (Number.isNaN(startsAt.getTime())) {
        setError(t('bookError'));
        return;
      }
      await continueAdvisorSession(props.session, startsAt.toISOString(), props.session.timezone || undefined);
      props.onContinued();
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
        padding: 16,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
        {props.advisorName ? `${label} · ${props.advisorName}` : label}
      </div>
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
        {props.onCancel && (
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
        )}
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy || !when}
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
          {busy ? t('booking') : label}
        </button>
      </div>
    </div>
  );
}
