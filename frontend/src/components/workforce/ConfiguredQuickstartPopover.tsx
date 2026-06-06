'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The reusable Quick Start one-liner, pre-configured for the user's currently
 * selected workgroup/account. Opened from the caret on the "Add agent" split
 * button. The install command carries the workspace token so a freshly installed
 * agent registers straight into THIS workgroup instead of prompting for a target.
 *
 * OS is auto-detected (PowerShell on Windows, bash on macOS/Linux) with a manual
 * override, mirroring the shared QuickStart component. The token is consumed by the installer as
 * BUILDERFORCE_TOKEN — see the Consolidated Gap Register for installer wiring.
 */

type Os = 'unix' | 'windows';

interface ConfiguredQuickstartPopoverProps {
  workgroupName: string;
  workgroupSlug?: string;
  tenantToken: string | null;
  onClose: () => void;
}

function detectOs(): Os {
  if (typeof navigator === 'undefined') return 'unix';
  const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const isWindows = uaPlatform === 'Windows' || navigator.userAgent.toLowerCase().includes('windows');
  return isWindows ? 'windows' : 'unix';
}

function buildCommand(os: Os, token: string | null, slug?: string): string {
  if (os === 'windows') {
    const env = [
      token ? `$env:BUILDERFORCE_TOKEN="${token}"` : null,
      slug ? `$env:BUILDERFORCE_WORKSPACE="${slug}"` : null,
    ].filter(Boolean);
    const prefix = env.length ? `${env.join('; ')}; ` : '';
    return `${prefix}iwr -useb https://builderforce.ai/install.ps1 | iex`;
  }
  const env = [
    token ? `BUILDERFORCE_TOKEN="${token}"` : null,
    slug ? `BUILDERFORCE_WORKSPACE="${slug}"` : null,
  ].filter(Boolean);
  const prefix = env.length ? `${env.join(' ')} ` : '';
  return `curl -fsSL https://builderforce.ai/install.sh | ${prefix}bash`;
}

const cardStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  zIndex: 50,
  width: 'min(440px, 92vw)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
  padding: 16,
  textAlign: 'left',
};

export function ConfiguredQuickstartPopover({
  workgroupName,
  workgroupSlug,
  tenantToken,
  onClose,
}: ConfiguredQuickstartPopoverProps) {
  const [os, setOs] = useState<Os>(detectOs);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const command = useMemo(() => buildCommand(os, tenantToken, workgroupSlug), [os, tenantToken, workgroupSlug]);

  // Dismiss on outside click or Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — user can select manually */ }
  };

  const osBtn = (value: Os): React.CSSProperties => ({
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    background: os === value ? 'var(--accent)' : 'transparent',
    color: os === value ? '#fff' : 'var(--text-strong)',
  });

  return (
    <div ref={ref} className="card" style={cardStyle} role="dialog" aria-label="Connect a new agent">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>
          Connect a new agent
        </h4>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
        >
          ×
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>
        Pre-configured for <strong style={{ color: 'var(--text-strong)' }}>{workgroupName}</strong>. Run this on
        any machine — the agent installs and registers straight into this workgroup.
      </p>

      {/* OS toggle */}
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
        <button type="button" style={osBtn('unix')} onClick={() => setOs('unix')}>macOS / Linux</button>
        <button type="button" style={osBtn('windows')} onClick={() => setOs('windows')}>Windows</button>
      </div>

      {/* Command block */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          background: 'var(--bg-deep, #0d0f14)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '10px 12px',
        }}
      >
        <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-strong)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {command}
        </code>
        <button
          type="button"
          onClick={copy}
          style={{
            flexShrink: 0, padding: '4px 10px', fontSize: 12, fontWeight: 600,
            background: copied ? 'var(--surface-coral-soft)' : 'var(--accent)',
            color: copied ? 'var(--accent)' : '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {!tenantToken && (
        <p style={{ fontSize: 11, color: 'var(--error-text)', margin: '10px 0 0' }}>
          No workspace token in this session — the agent will prompt you to pick a workgroup on first run.
        </p>
      )}
    </div>
  );
}
