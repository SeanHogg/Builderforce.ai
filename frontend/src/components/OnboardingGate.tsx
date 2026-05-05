'use client';

/**
 * Pessimistically gates the chrome of any authenticated route.
 *
 * - pre-auth        → render `null` (middleware handles the redirect; this is
 *                     just a client-side safety net so route content cannot
 *                     flash before navigation completes).
 * - loading         → render a non-flashing skeleton; never the real chrome.
 * - pending-terms   → full-screen `<TermsAcceptanceScreen>`. Chrome stays
 *                     hidden; an existing user can accept terms here without
 *                     needing access to a separate route.
 * - pending-tenant  → render children. Middleware should already have routed
 *                     the user to `/tenants`, which renders its own selector
 *                     content. Other authed routes never reach this branch.
 * - ready           → render children inside the surrounding shell.
 */

import { useState } from 'react';
import { useOnboardingState, type ActiveTermsDoc } from '@/lib/onboarding';

interface OnboardingGateProps {
  children: React.ReactNode;
  /** Surrounding shell (AppShell). Only invoked once the gate is past terms. */
  renderShell: (gatedChildren: React.ReactNode) => React.ReactNode;
}

export default function OnboardingGate({ children, renderShell }: OnboardingGateProps) {
  const { phase, loading, terms, acceptTerms } = useOnboardingState();

  if (phase === 'pre-auth') return null;

  if (loading) return <GateSkeleton />;

  if (phase === 'pending-terms' && terms) {
    return <TermsAcceptanceScreen terms={terms} onAccept={acceptTerms} />;
  }

  // 'pending-tenant' and 'ready' both render the shell. Middleware ensures
  // pending-tenant only reaches /tenants, where the page itself draws the
  // selector content.
  return <>{renderShell(children)}</>;
}

function GateSkeleton() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-deep)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: '0.875rem',
        fontFamily: 'var(--font-body)',
      }}
    >
      Loading…
    </div>
  );
}

interface TermsAcceptanceScreenProps {
  terms: ActiveTermsDoc;
  onAccept: () => Promise<void>;
}

function TermsAcceptanceScreen({ terms, onAccept }: TermsAcceptanceScreenProps) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onAccept();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept terms');
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-deep)',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 720,
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 16,
          boxShadow: '0 16px 48px var(--shadow-coral-soft)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: '1.25rem',
              fontWeight: 700,
            }}
          >
            {terms.title} · v{terms.version}
          </h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            We updated our terms. Accept the current version to continue using your account.
          </p>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <pre
            style={{
              margin: 0,
              fontFamily: 'var(--font-body)',
              fontSize: '0.875rem',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {terms.content}
          </pre>
        </div>

        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {error && (
            <div
              style={{
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.4)',
                color: '#f87171',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: '0.875rem',
              }}
            >
              {error}
            </div>
          )}

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 3, accentColor: 'var(--coral-bright)' }}
            />
            <span>
              I agree to the {terms.title} (v{terms.version}) and the Privacy Policy.
            </span>
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={submit}
              disabled={!agreed || submitting}
              style={{
                padding: '11px 20px',
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: !agreed || submitting ? 'not-allowed' : 'pointer',
                opacity: !agreed || submitting ? 0.5 : 1,
                letterSpacing: '0.02em',
              }}
            >
              {submitting ? 'Saving…' : 'Accept and continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
