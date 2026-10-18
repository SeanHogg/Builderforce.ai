import Link from 'next/link';
import MascotIcon from '@/components/MascotIcon';
import { persistSession } from '@/lib/auth';
import { resolveAndSelectTenant } from '@/lib/auth/credentials';
import { safeRedirectPath } from '@/lib/safeRedirect';
import type { AuthUser } from '@/lib/types';

/**
 * The screen an emailed or federated sign-in link lands on: a pulsing mark while
 * the link is exchanged for a session, or a card naming why it could not be and
 * leading back to the login form. The OAuth callback and the magic-link pages
 * rendered the identical pair; only the exchange request and the wording differ.
 */
export interface AuthStatusScreenProps {
  loadingLabel: string;
  /** Set when the exchange failed; replaces the loader with the failure card. */
  failure: { title: string; message: string; backLabel: string } | null;
}

export function AuthStatusScreen({ loadingLabel, failure }: AuthStatusScreenProps) {
  if (failure) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-deep)',
          color: 'var(--text-primary)',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-xl)',
            padding: '40px 32px',
            textAlign: 'center',
            backdropFilter: 'blur(12px)',
          }}
        >
          <MascotIcon size={48} className="bf-mark-muted" />
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--font-size-section)',
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            {failure.title}
          </h2>
          <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', marginBottom: 24 }}>
            {failure.message}
          </p>
          <Link
            href="/login"
            style={{
              display: 'inline-block',
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: 'var(--text-on-accent)',
              borderRadius: 'var(--radius-lg)',
              padding: '10px 24px',
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 'var(--font-size-body)',
              textDecoration: 'none',
            }}
          >
            {failure.backLabel}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <MascotIcon size={56} className="bf-mark-pulse" />
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-body)' }}>{loadingLabel}</p>
      </div>
    </div>
  );
}

export interface SignInExchange {
  token?: string;
  user?: AuthUser;
  redirect?: string;
}

/**
 * Store the session the exchange returned, pick the workspace and leave for the
 * (same-origin only) destination. Throws when the exchange carried no session so
 * the caller's `.catch` shows its failure card.
 */
export async function completeTokenSignIn(data: SignInExchange, fallbackError: string): Promise<void> {
  if (!data.token || !data.user) throw new Error(fallbackError);
  persistSession(data.token, data.user);
  await resolveAndSelectTenant(data.token);
  // safeRedirectPath is defence-in-depth — the server already validated it.
  window.location.href = safeRedirectPath(data.redirect);
}
