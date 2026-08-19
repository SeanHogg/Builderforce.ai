// No 'use client' directive: `BillingClient.tsx` is the only thing that renders
// this and already carries one, so the boundary genuinely begins there. A second
// directive downstream of an established boundary changes nothing except the
// architecture ratchet's count.

/**
 * THE "get paid" surface — the tenant's own merchant account (FO-C4).
 *
 * ── WHAT IT CLOSES ───────────────────────────────────────────────────────────
 * `PayoutConnections` is the mirror of this component and it has existed for a
 * while: where money goes OUT. There was nothing at all for money coming IN. A
 * workspace could pay its people and could not charge its customers, which made
 * the whole finance seat one-directional — and a company can be run on a product
 * that cannot collect revenue only for as long as it has no revenue.
 *
 * ── WHY IT DECIDES ITS OWN VISIBILITY AND ITS OWN STATE ─────────────────────
 * Same argument `PayoutConnections` makes, and the same one the DRY rule states:
 * a consumer passes only `returnTo` — where the processor's round trip should land
 * the browser back — because that is the one fact this component genuinely cannot
 * know. Whether an account exists, whether it can take a card, and what is still
 * outstanding are all things it reads for itself, so a second surface rendering it
 * cannot show a different answer.
 *
 * ── WHY "CONNECTED" IS NOT THE HEADLINE ─────────────────────────────────────
 * `chargesEnabled` is. An account can exist, look connected, and be unable to take
 * a payment because a document is outstanding — and the way a tenant finds that
 * out, if this screen reports mere existence, is a customer telling them the link
 * did not work. So the affirmative state is "you can take card payments" and
 * anything less says exactly what is missing, in the processor's own words.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  disconnectMerchant,
  merchantAccount,
  startMerchantOnboarding,
  type MerchantAccountView,
} from '@/lib/founderOpsApi';

export interface MerchantAccountProps {
  /** Where the processor's round trip returns to. */
  returnTo: string;
  /** Told when the account changed, so a page showing receivables beside this can
   *  refresh them — an invoice issued before onboarding has no payment link. */
  onChanged?: () => void;
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  background: 'var(--bg-base)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 'var(--font-size-body)',
  padding: '4px 0',
};

/** The one place a status becomes a colour, so the three states cannot be tinted
 *  differently by two callers. Both themes are covered because every value is a
 *  token — see [[theme-and-responsive-ui]]. */
const STATUS_COLOR: Record<string, string> = {
  connected: 'var(--success-strong, var(--text-primary))',
  restricted: 'var(--coral-bright)',
  pending: 'var(--text-muted)',
  absent: 'var(--text-muted)',
};

export function MerchantAccount({ returnTo, onChanged }: MerchantAccountProps) {
  const t = useTranslations('merchant');
  const confirm = useConfirm();
  const [account, setAccount] = useState<MerchantAccountView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setAccount(await merchantAccount());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    setBusy(true);
    try {
      const { onboardingUrl } = await startMerchantOnboarding({ returnTo });
      // A full navigation and not a popup: the processor's onboarding is a
      // multi-step identity flow that a blocked popup turns into a dead end.
      window.location.href = onboardingUrl;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('connectFailed'));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!(await confirm({
      title: t('disconnectTitle'),
      message: t('disconnectBody'),
      confirmLabel: t('disconnectConfirm'),
      destructive: true,
    }))) return;
    setBusy(true);
    try {
      await disconnectMerchant();
      await load();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('disconnectFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: 0 }}>{t('loading')}</p>;

  const status = account?.connected ? account.status : 'absent';
  const canCharge = account?.chargesEnabled === true;

  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <span style={{ color: 'var(--text-muted)' }}>{t('statusLabel')}</span>
        <strong style={{ color: STATUS_COLOR[status] ?? 'var(--text-primary)' }}>
          {t(`status.${status}` as 'status.absent')}
        </strong>
      </div>

      <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
        {canCharge ? t('readyBody') : account?.connected ? t('incompleteBody') : t('absentBody')}
      </p>

      {account?.connected && (
        <div style={{ display: 'grid', gap: 2 }}>
          {[
            { label: t('country'), value: account.country ?? t('unknown') },
            { label: t('currency'), value: account.defaultCurrency ?? t('unknown') },
            { label: t('payoutsLabel'), value: account.payoutsEnabled ? t('yes') : t('no') },
          ].map(({ label, value }) => (
            <div key={label} style={rowStyle}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ color: 'var(--text-primary)' }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* The processor's own words for what is still outstanding. Rendered raw
          rather than translated: these are regulatory requirement keys, and a
          hand-written translation of one would be a guess at a legal obligation. */}
      {account?.requirements?.length ? (
        <div>
          <div style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', marginBottom: 6 }}>{t('outstandingTitle')}</div>
          <ul style={{ margin: 0, paddingInlineStart: 20, fontSize: 'var(--font-size-body)', color: 'var(--text-primary)' }}>
            {account.requirements.slice(0, 8).map((requirement) => (
              <li key={requirement} style={{ wordBreak: 'break-word' }}>{requirement}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error && <p role="alert" style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-body)', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Button onClick={connect} disabled={busy}>
          {account?.connected ? t('resume') : t('connect')}
        </Button>
        {account?.connected && (
          <Button variant="secondary" onClick={disconnect} disabled={busy}>{t('disconnect')}</Button>
        )}
      </div>
    </div>
  );
}
