'use client';

/**
 * AgentCheckoutPanel — buy a priced marketplace agent, then hire it.
 *
 * A marketplace agent could carry a price and never be charged for: `hire`
 * ignored `price_cents` entirely. This is the buyer-side half of closing that —
 * the price, the payment, the return leg, and the hire that only now succeeds
 * once the payment is recorded.
 *
 * ── THE THREE-SHAPE START ────────────────────────────────────────────────────
 * `startCheckout` answers `{ free }`, `{ purchased }` or `{ checkoutUrl }`, and
 * this component branches on all three rather than assuming a URL. A free agent
 * and an already-bought one both go straight to hire, which is why a free agent
 * behaves here exactly as it did before any of this existed.
 *
 * ── THE RETURN LEG IS NOT OPTIONAL ───────────────────────────────────────────
 * The processor redirects back with `?checkout=<session>&agent=<id>`. Until
 * `completeCheckout` runs, the money has moved and the workspace owns nothing —
 * so the effect below runs it on mount, and only then hires. It clears the query
 * string afterwards so a refresh cannot replay it (the server is idempotent
 * regardless; this is about not showing the buyer a second "purchasing…").
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { agentCheckoutApi } from '@/lib/builderforceApi';
import { isPurchaseRequiredError } from '@/lib/planLimitError';

export interface AgentCheckoutPanelProps {
  agentId: string;
  agentName: string;
  priceCents: number;
  /** 'flat_fee' | 'consumption' — a consumption agent prices per unit. */
  pricingModel?: string | null;
  /** e.g. "per 1K tokens". Only meaningful for consumption pricing. */
  priceUnit?: string | null;
  /** True once this workspace holds the agent — renders the acquired state. */
  alreadyHired?: boolean;
  /** Called after a successful hire so the parent can refresh its list. */
  onHired?: (agentId: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

type Phase = 'idle' | 'starting' | 'completing' | 'hiring' | 'done' | 'error';

const card: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 14,
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  // Never let a long agent name or a wide price row push the page sideways.
  minWidth: 0,
};

const primaryButton: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 700,
  background: 'var(--coral-bright)',
  color: 'var(--text-on-accent)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

export function AgentCheckoutPanel({
  agentId,
  agentName,
  priceCents,
  pricingModel,
  priceUnit,
  alreadyHired = false,
  onHired,
  className,
  style,
}: AgentCheckoutPanelProps) {
  const t = useTranslations('agentCheckout');
  const router = useRouter();
  const params = useSearchParams();
  const [phase, setPhase] = useState<Phase>(alreadyHired ? 'done' : 'idle');
  const [message, setMessage] = useState<string | null>(null);

  const isFree = priceCents <= 0;
  const priceLabel = isFree
    ? t('free')
    : `$${(priceCents / 100).toFixed(2)}${pricingModel === 'consumption' && priceUnit ? ` ${priceUnit}` : ''}`;

  /** Acquire the agent. Safe to call for free, bought and just-paid agents alike. */
  const hire = useCallback(async () => {
    setPhase('hiring');
    setMessage(null);
    try {
      await agentCheckoutApi.hire(agentId);
      setPhase('done');
      onHired?.(agentId);
    } catch (error) {
      // A 402 here means the server still sees no purchase — the honest thing to
      // say is "this needs paying for", never the plan-upgrade message a generic
      // 402 handler would have shown.
      setMessage(isPurchaseRequiredError(error) ? t('purchaseRequired') : errorText(error, t('hireFailed')));
      setPhase('error');
    }
  }, [agentId, onHired, t]);

  // ---- the return leg from the processor -----------------------------------
  useEffect(() => {
    const sessionId = params.get('checkout');
    const returnedAgent = params.get('agent');
    if (!sessionId || sessionId === 'cancelled' || returnedAgent !== agentId) return;

    let cancelled = false;
    (async () => {
      setPhase('completing');
      try {
        await agentCheckoutApi.completeCheckout(agentId, sessionId);
        if (cancelled) return;
        await hire();
      } catch (error) {
        if (cancelled) return;
        setMessage(errorText(error, t('completeFailed')));
        setPhase('error');
      } finally {
        // Drop the checkout params so a refresh does not re-run the settlement.
        if (!cancelled) router.replace(window.location.pathname);
      }
    })();
    return () => { cancelled = true; };
    // `hire` is stable via useCallback; re-running on every param change is the
    // point — a second redirect for a different agent must settle too.
  }, [agentId, params, router, hire, t]);

  const buy = async () => {
    setPhase('starting');
    setMessage(null);
    try {
      const result = await agentCheckoutApi.startCheckout(
        agentId,
        `${window.location.origin}${window.location.pathname}`,
      );
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      // Free, or already bought — both mean there is nothing to pay and the
      // agent can be taken straight into the workspace.
      await hire();
    } catch (error) {
      setMessage(errorText(error, t('checkoutFailed')));
      setPhase('error');
    }
  };

  const busy = phase === 'starting' || phase === 'completing' || phase === 'hiring';

  return (
    <div className={className} style={{ ...card, ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 'var(--font-size-body)', color: 'var(--text-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>
          {agentName}
        </div>
        <div style={{ fontWeight: 700, fontSize: 'var(--font-size-small)', color: isFree ? 'var(--text-muted)' : 'var(--text-primary)' }}>
          {priceLabel}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        {isFree ? t('freeExplainer') : t('paidExplainer')}
      </p>

      {phase === 'done' ? (
        <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('hired')}
        </div>
      ) : (
        <button type="button" onClick={buy} disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}>
          {phase === 'completing' ? t('completing')
            : phase === 'hiring' ? t('hiring')
            : phase === 'starting' ? t('starting')
            : isFree ? t('hireFree') : t('buy')}
        </button>
      )}

      {message && (
        <div
          role="alert"
          style={{
            padding: '8px 10px',
            fontSize: 'var(--font-size-small)',
            color: 'var(--error-text)',
            background: 'var(--error-bg)',
            border: '1px solid var(--error-border)',
            borderRadius: 'var(--radius-sm)',
            overflowWrap: 'anywhere',
          }}
        >
          {message}
        </div>
      )}

      {phase === 'done' && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-field-label)', color: 'var(--text-muted)' }}>
          {t('provisionedNote')}
        </p>
      )}
    </div>
  );
}

/** The server's own wording when it gave one, the caller's fallback otherwise. */
function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
