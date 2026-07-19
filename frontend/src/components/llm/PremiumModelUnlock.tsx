'use client';

import { useTranslations } from 'next-intl';
import { useLlmModels } from '@/lib/useLlmModels';
import { useStartCardValidation } from '@/lib/useCardValidation';

/**
 * PremiumModelUnlock — the CTA that turns on PREMIUM model selection: any paid
 * OpenRouter model, billed at OpenRouter's own per-token price plus a flat 1¢ per
 * request.
 *
 * Premium is gated on a paid plan AND a card that passed an explicit validation
 * (a $0 SetupIntent — no charge; it only proves the card is usable, since premium is
 * metered per request rather than sold as a plan). The server decides that in ONE
 * place (`evaluatePremiumModelAccess`) and reports both the verdict and the exact
 * unlock step; this component just renders it.
 *
 * Self-deciding visibility (per the shared-component rule): it renders nothing when
 * the tenant is already entitled, or when there's nothing actionable to say. Consumers
 * drop it next to a ModelSelect with no props and no `canX` prop-drilling.
 */
export function PremiumModelUnlock() {
  const t = useTranslations('modelSelect');
  const { canUsePremiumModels, premiumInfo } = useLlmModels();
  // SHARED card-validation flow (see useStartCardValidation) — the chat error
  // banner drives the identical unlock, so neither surface re-implements it.
  const { start: startValidation, busy, error } = useStartCardValidation();

  // Already entitled → nothing to unlock. No payload yet → say nothing rather than
  // flash a paywall at someone who may well be entitled.
  if (canUsePremiumModels || !premiumInfo) return null;

  const needsCard = premiumInfo.unlock === 'validate_card';
  const pending = premiumInfo.cardValidationStatus === 'pending';
  const failed = premiumInfo.cardValidationStatus === 'failed';

  return (
    <div style={wrapStyle}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
        {t('premiumUnlockTitle')}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
        {needsCard ? t('premiumUnlockCardBody') : t('premiumUnlockUpgradeBody')}
      </p>

      {needsCard ? (
        <div style={rowStyle}>
          <button
            type="button"
            onClick={startValidation}
            disabled={busy || pending}
            style={{ ...buttonPrimary, opacity: busy || pending ? 0.6 : 1, cursor: busy || pending ? 'default' : 'pointer' }}
          >
            {busy ? t('premiumValidating') : pending ? t('premiumPending') : t('premiumValidateCard')}
          </button>
          {pending && <span style={hintStyle}>{t('premiumPendingHint')}</span>}
          {failed && <span style={{ ...hintStyle, color: 'var(--danger, #ef4444)' }}>{t('premiumFailedHint')}</span>}
        </div>
      ) : (
        <a href="/pricing?upgrade=pro" style={{ ...buttonPrimary, display: 'inline-block', textDecoration: 'none' }}>
          {t('premiumUpgrade')}
        </a>
      )}

      {error !== null && (
        <div role="alert" style={{ ...hintStyle, color: 'var(--danger, #ef4444)' }}>
          {error || t('premiumUnlockFailed')}
        </div>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 12, padding: 16, maxWidth: '100%',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
};
const buttonPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 12, fontWeight: 600,
  background: 'var(--surface-interactive)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 8, minHeight: 36,
};
const hintStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-secondary)',
};
