'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useConsumption, invalidateConsumption } from '@/lib/useConsumption';

/**
 * The account-tier chip: which plan funds this workspace, and — on a metered plan
 * — how much allowance is left.
 *
 * A free member with a small allowance and no card looks, from inside a chat,
 * identical to a broken install: the model seems weak (no premium entitlement)
 * and turns stop mid-answer (the token cap 429). The web Brain only ever surfaced
 * that reactively, once a turn had already died on a 402/429. This chip states it
 * up front, and clicking it lands on the page that changes it.
 *
 * Self-gating (the DRY rule): it fetches its own snapshot through the shared
 * cached {@link useConsumption} and renders nothing until it knows a plan — never
 * a misleading "Free" while loading — so a consumer just drops it in a header
 * without computing entitlement or passing a `canX` prop.
 *
 * Mirrors the VS Code extension's `PlanBadge` (clients/vscode/webview/src/accountPlan.tsx);
 * the two stacks can't share a component, but they read the same endpoint and
 * present the same three states.
 */
export function PlanBadge() {
  const t = useTranslations('planBadge');
  const snapshot = useConsumption();
  if (!snapshot) return null;

  const tier = snapshot.plan.effective;
  const isFree = tier === 'free';
  const meter = snapshot.meters.find((m) => m.key === 'ai_tokens');
  // "Tokens left" only means something on a metered plan; an unlimited or absent
  // meter shows the tier alone rather than inventing a number.
  const remaining = meter && !meter.unlimited && meter.remaining >= 0 ? meter.remaining : null;
  const exhausted = remaining !== null && remaining <= 0;

  // A tier the catalog doesn't know (a plan added server-side ahead of the copy)
  // must not throw in a header — fall back to the raw key, title-cased.
  const tierKey = `tier.${tier}` as 'tier.free';
  const label = t.has(tierKey) ? t(tierKey) : tier.replace(/^./, (ch) => ch.toUpperCase());
  const title = isFree ? t('freeHint') : t('paidHint', { plan: label });

  // Free + out of allowance is the one state that must read as a problem; free
  // with headroom is a call to action; a paid plan is neutral reassurance. All
  // three are theme tokens, so the chip is legible in light AND dark themes.
  const tone = exhausted
    ? 'var(--error-text, #dc2626)'
    : isFree
      ? 'var(--accent, #3b82f6)'
      : 'var(--text-muted, #6b7280)';

  return (
    <Link
      href={isFree ? '/pricing?upgrade=pro' : '/pricing'}
      title={title}
      aria-label={title}
      onClick={invalidateConsumption}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        // Shrinkable, never a fixed width: the chip sits in a crowded header that
        // must still fit a ~360px viewport.
        flex: '0 1 auto',
        minWidth: 0,
        maxWidth: '100%',
        padding: '1px 7px',
        fontSize: 9,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
        border: '1px solid currentColor',
        borderRadius: 999,
        background: 'transparent',
        color: tone,
        textDecoration: 'none',
      }}
    >
      <span>{label}</span>
      {/* The allowance readout is supporting detail — dropped first when the
          header is too narrow to hold everything. */}
      {remaining !== null && (
        <span
          style={{
            fontWeight: 600,
            textTransform: 'none',
            letterSpacing: 0,
            opacity: 0.85,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {exhausted ? t('noTokens') : t('tokensLeft', { count: remaining.toLocaleString() })}
        </span>
      )}
      {isFree && (
        <span aria-hidden style={{ fontWeight: 700, opacity: 0.9 }}>{t('upgrade')}</span>
      )}
    </Link>
  );
}

export default PlanBadge;
