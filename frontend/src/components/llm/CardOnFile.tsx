'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useConfirm } from '@/components/ConfirmProvider';
import { useStartCardValidation } from '@/lib/useCardValidation';
import { cardValidationApi, type CardValidationState } from '@/lib/builderforceApi';

/**
 * The card BuilderForce has on file, and the only way to change it.
 *
 * Premium model access is gated on a validated card, but once validated that card
 * became invisible and immutable: the tenant could see a payment method under
 * Current Plan (that's the SUBSCRIPTION's card, a different thing) while the card
 * actually holding their premium entitlement had no surface at all. An expired or
 * replaced card therefore revoked premium with nothing on screen to act on.
 *
 * Complements {@link PremiumModelUnlock}, which owns the "no card yet" CTA. This
 * one owns the after state — so the two never both render, and between them every
 * card status has exactly one home:
 *
 *   none      → PremiumModelUnlock ("Validate a card")
 *   pending   → this component (in-flight notice)
 *   validated → this component (the card + Replace)
 *   failed    → this component (the failure + Try again)
 *
 * Self-gating per the shared-component rule: it fetches its own state and returns
 * null when there is nothing to manage — consumers drop it in with no props.
 */
export function CardOnFile() {
  const t = useTranslations('billing');
  const { tenant } = useAuth();
  const confirm = useConfirm();
  const { start, busy, error: startError } = useStartCardValidation();
  const [state, setState] = useState<CardValidationState | null>(null);

  // `Tenant.id` is a string on the client but the API is numeric — same coercion
  // the pricing/dashboard pages use.
  const tenantId = tenant?.id != null && tenant.id !== '' ? Number(tenant.id) : null;

  useEffect(() => {
    if (tenantId == null) { setState(null); return; }
    let alive = true;
    // Best-effort: a failed read leaves the section hidden rather than showing a
    // broken card row. The endpoint is tenant-scoped and cheap (one row).
    cardValidationApi.get(tenantId)
      .then((s) => { if (alive) setState(s); })
      .catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
  }, [tenantId]);

  // Nothing on file → PremiumModelUnlock is the surface for that, not this one.
  if (!state || state.status === 'none') return null;

  const replace = async () => {
    // Re-running validation resets the tenant to `pending` until the processor's
    // webhook confirms, which SUSPENDS premium access in the meantime. That is a
    // real consequence of pressing this button, so it is stated before the fact
    // rather than discovered afterwards.
    const ok = await confirm({
      title: t('replaceCardTitle'),
      message: state.validated ? t('replaceCardWarning') : t('retryCardMessage'),
      confirmLabel: t('replaceCardConfirm'),
      destructive: false,
    });
    if (ok) await start();
  };

  const statusLabel = state.status === 'validated'
    ? t('cardStatusValidated')
    : state.status === 'pending'
      ? t('cardStatusPending')
      : t('cardStatusFailed');

  // Validated reads as success, pending as in-progress, failed as a problem — all
  // from theme tokens so both light and dark themes stay legible.
  const statusColor = state.status === 'validated'
    ? 'var(--success, #16a34a)'
    : state.status === 'pending'
      ? 'var(--text-muted)'
      : 'var(--danger, #dc2626)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        flexWrap: 'wrap',
        padding: 16,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
          {t('cardOnFileTitle')}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
          {state.brand && state.last4 ? (
            <span style={{ color: 'var(--text-primary)' }}>
              <span style={{ textTransform: 'capitalize' }}>{state.brand}</span> ···· {state.last4}
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>{t('cardNoDetails')}</span>
          )}
          <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
          {state.status === 'pending' ? t('cardPendingHint') : t('cardOnFileHint')}
        </p>

        {startError !== null && (
          <div role="alert" style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 6 }}>
            {startError || t('cardValidationFailed')}
          </div>
        )}
      </div>

      {/* A pending validation is already in flight — a second one would only reset
          the clock, so the action waits rather than offering a no-op. */}
      {state.status !== 'pending' && (
        <button
          type="button"
          onClick={() => void replace()}
          disabled={busy}
          style={{
            flex: '0 0 auto',
            padding: '9px 18px',
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--bg-surface, transparent)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? t('cardWorking') : state.validated ? t('replaceCard') : t('retryCard')}
        </button>
      )}
    </div>
  );
}
