'use client';

import { useEffect, useRef } from 'react';

interface InstallCoderClawProps {
  /** Workspace token to auto-configure the installed agent. */
  tenantToken?: string | null;
}

/**
 * Reusable "Install CoderClaw" step — wraps the <ccl-quickstart> Lit web component.
 * Renders the full quickstart UI with all installation modes (one-liner, npm, hackable, macOS).
 */
export function InstallCoderClaw({ tenantToken }: InstallCoderClawProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Dynamically import the Lit web component on the client only
  useEffect(() => {
    import('./ccl-quickstart').catch(() => null);
  }, []);

  return (
    <div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
        Download and install the CoderClaw agent on your machine. It will automatically
        register with your workspace so you can delegate tasks immediately.
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
          Your workspace token is pre-configured — the agent will register automatically on first run.
        </div>
      )}

      <div ref={containerRef}>
        {/* @ts-expect-error: custom Lit element */}
        <ccl-quickstart />
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
        You can also do this later from the{' '}
        <a href="/workforce" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>
          Workforce
        </a>{' '}
        page.
      </p>
    </div>
  );
}
