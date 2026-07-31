'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useConfirm } from '@/components/ConfirmProvider';
import { useStartCardValidation } from '@/lib/useCardValidation';
import { invalidateLlmModels } from '@/lib/useLlmModels';
import { invalidateConsumption } from '@/lib/useConsumption';
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
/** Shared chrome for the Replace / Remove actions — same shape, tone differs. */
const actionButton: React.CSSProperties = {
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 600,
  background: 'var(--bg-surface, transparent)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
};

export function CardOnFile() {
  const t = useTranslations('billing');
  const { tenant } = useAuth();
  const confirm = useConfirm();
  const { start, busy: startBusy, error: startError } = useStartCardValidation();
  const [state, setState] = useState<CardValidationState | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Either action in flight disables both — they'd contend for the same record.
  const busy = startBusy || removing;
  const setBusy = setRemoving;

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

  /**
   * Remove the card entirely. Premium access goes with it — stated plainly, since
   * that is the consequence the user is least likely to have predicted. The server
   * refuses (409) while a paid plan still bills this card; that message is already
   * user-facing, so it is shown as-is rather than being second-guessed here.
   */
  const remove = async () => {
    if (tenantId == null) return;
    const ok = await confirm({
      title: t('removeCardTitle'),
      message: t('removeCardWarning'),
      confirmLabel: t('removeCardConfirm'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setRemoveError(null);
    try {
      const next = await cardValidationApi.remove(tenantId);
      setState(next);
      // Premium entitlement just changed — drop the cached model lists and plan
      // chip so every surface stops offering models this tenant can no longer use.
      invalidateLlmModels();
      invalidateConsumption();
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : t('removeCardFailed'));
    } finally {
      setBusy(false);
    }
  };

  const replace = async () => {
    // Add-then-swap (migration 0346): the current card stays validated until the
    // new one is confirmed, then the server detaches the old one. So this confirm
    // reassures rather than warns — there is no access gap to disclose. The
    // `retry` variant still explains the $0 charge for a failed card.
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

        {(startError !== null || removeError !== null) && (
          <div role="alert" style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 6 }}>
            {removeError || startError || t('cardValidationFailed')}
          </div>
        )}
      </div>

      {/* A pending validation is already in flight — a second one would only reset
          the clock, so the actions wait rather than offering a no-op. */}
      {state.status !== 'pending' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: '0 0 auto' }}>
          <button
            type="button"
            onClick={() => void replace()}
            disabled={busy}
            style={{ ...actionButton, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? t('cardWorking') : state.validated ? t('replaceCard') : t('retryCard')}
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            style={{
              ...actionButton,
              color: 'var(--danger, #dc2626)',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {t('removeCard')}
          </button>
        </div>
      )}
    </div>
  );
}
