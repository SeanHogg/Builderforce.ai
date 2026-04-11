'use client';

import { useRouter } from 'next/navigation';
import { PlanLimitError } from '@/lib/planLimitError';

export interface UpgradeModalProps {
  /** When set, modal is shown and its message/plan come from this error. */
  error: PlanLimitError | null;
  /** Called when the user dismisses the modal (X, overlay click, or Continue). */
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
  title = 'Upgrade to unlock more',
  dismissLabel = 'Not now',
}: UpgradeModalProps) {
  const router = useRouter();
  if (!error) return null;

  const planLabel = formatPlan(error.currentPlan);

  const handleUpgrade = () => {
    onClose();
    router.push(`/pricing?upgrade=${upgradeTarget}`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
      className="modal-overlay"
      style={{ zIndex: 100 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: '92%',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          padding: 28,
          fontFamily: 'var(--font-display)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
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
            }}
          >
            ⚡
          </div>
          <div>
            <h2
              id="upgrade-modal-title"
              style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}
            >
              {title}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              You&apos;re on the <strong style={{ color: 'var(--text-secondary)' }}>{planLabel}</strong> plan
            </div>
          </div>
        </div>

        <p style={{ margin: '8px 0 20px', fontSize: 14, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          {error.message}
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
            Upgrade
          </button>
        </div>
      </div>
    </div>
  );
}
