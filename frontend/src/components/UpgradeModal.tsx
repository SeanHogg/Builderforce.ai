'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PlanLimitError } from '@/lib/planLimitError';
import { SlideOutPanel } from '@/components/SlideOutPanel';

export interface UpgradeModalProps {
  /** When set, the panel is shown and its message/plan come from this error. */
  error: PlanLimitError | null;
  /** Called when the user dismisses the panel (X, overlay click, or Continue). */
  onClose: () => void;
  /** Optional target plan for the pricing page deep link. Defaults to 'pro'. */
  upgradeTarget?: 'pro' | 'teams';
  /** Override the default title. */
  title?: string;
  /** Optional dismiss-button label. Defaults to "Not now". */
  dismissLabel?: string;
}

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  teams: 'Teams',
};

function formatPlan(plan: string): string {
  return PLAN_LABEL[plan.toLowerCase()] ?? plan;
}

export function UpgradeModal({
  error,
  onClose,
  upgradeTarget = 'pro',
  title: titleOverride,
  dismissLabel: dismissLabelOverride,
}: UpgradeModalProps) {
  const router = useRouter();
  const t = useTranslations('upgradeModal');
  const title = titleOverride ?? t('title');
  const dismissLabel = dismissLabelOverride ?? t('dismiss');
  const planLabel = error ? formatPlan(error.currentPlan) : '';

  const handleUpgrade = () => {
    onClose();
    router.push(`/pricing?upgrade=${upgradeTarget}`);
  };

  return (
    <SlideOutPanel open={error != null} onClose={onClose} title={title} width="min(480px, 96vw)">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            aria-hidden
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              fontSize: 22,
              flexShrink: 0,
            }}
          >
            ⚡
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t.rich('onPlan', {
              plan: planLabel,
              strong: (chunks) => <strong style={{ color: 'var(--text-secondary)' }}>{chunks}</strong>,
            })}
          </div>
        </div>

        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          {error?.message}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 16px',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              background: 'var(--bg-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            {dismissLabel}
          </button>
          <button
            type="button"
            onClick={handleUpgrade}
            style={{
              padding: '9px 20px',
              fontSize: 13,
              fontWeight: 700,
              color: '#fff',
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
              boxShadow: '0 4px 14px var(--shadow-coral-mid)',
            }}
          >
            {t('upgrade')}
          </button>
        </div>
      </div>
    </SlideOutPanel>
  );
}
