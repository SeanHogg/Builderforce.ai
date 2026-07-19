'use client';

import { useTranslations } from 'next-intl';
import QuickStart from './QuickStart';

interface InstallBuilderForceAgentsProps {
  /** Workspace token to auto-configure the installed agent. */
  tenantToken?: string | null;
}

/**
 * Reusable "Install BuilderForce Agents" step — wraps the shared <QuickStart /> component.
 * Renders the full quickstart UI with all installation modes (one-liner, npm, hackable, macOS).
 */
export function InstallBuilderForceAgents({ tenantToken }: InstallBuilderForceAgentsProps) {
  const t = useTranslations('installAgents');
  return (
    <div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
        {t('intro')}
      </p>

      {tenantToken && (
        <div
          style={{
            background: 'rgba(0,229,204,0.06)',
            border: '1px solid rgba(0,229,204,0.2)',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 20,
            fontSize: 12,
            color: 'var(--cyan-bright, #00e5cc)',
          }}
        >
          {t('tokenPreconfigured')}
        </div>
      )}

      <QuickStart />

      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
        {t.rich('laterHint', {
          link: (chunks) => (
            <a href="/workforce" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>
              {chunks}
            </a>
          ),
        })}
      </p>
    </div>
  );
}
