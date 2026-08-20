import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { CloudRunAllowance } from '@/lib/builderforceApi';

/**
 * "This workspace is over its cloud-run allowance" — stated ONCE, for the
 * workspace (ROADMAP DISP-R3).
 *
 * ── WHY A BANNER AND NOT A BADGE PER CARD ───────────────────────────────────
 * Exhausting the monthly cloud-run allowance stops autonomy on every ticket on
 * every board, identically — it is one fact about the workspace. It used to be
 * discovered per ticket, deep inside the dispatcher, which meant an over-cap
 * tenant with 200 active tickets wrote 200 near-identical refusal rows per sweep
 * tick and a reader saw 200 separately-stalled cards with no way to see the single
 * cause. Now the sweep checks once per tenant per tick and this says it once.
 *
 * The component decides its own visibility: it renders nothing when the workspace
 * is inside its allowance, and nothing when the meter could not be read — "we
 * could not tell" is not "you are over", and showing it as one would send an
 * operator to the pricing page over a metering hiccup.
 */
export function WorkspaceAllowanceBanner({ allowance }: { allowance: CloudRunAllowance | null }) {
  const t = useTranslations('board');
  if (!allowance?.overAllowance) return null;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--warning-border, var(--border-subtle))',
        background: 'var(--warning-bg, var(--bg-elevated))',
        color: 'var(--text-primary)',
        fontSize: 'var(--font-size-small)',
        lineHeight: 1.5,
      }}
    >
      <strong>{t('allowance.title')}</strong>
      <span style={{ color: 'var(--text-secondary)' }}>
        {t('allowance.detail', { used: allowance.used, limit: allowance.limit, plan: allowance.plan })}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>{t('allowance.onPremNote')}</span>
      <Link
        href="/pricing"
        style={{ marginLeft: 'auto', color: 'var(--link, var(--text-primary))', fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        {t('allowance.upgrade')}
      </Link>
    </div>
  );
}
