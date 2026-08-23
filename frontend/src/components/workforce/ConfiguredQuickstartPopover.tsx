'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

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

// Positioning is owned by the caller's `AnchoredPopover` (a portal, so it can
// escape the toolbar's own stacking context) — this only draws the card.
const cardStyle: React.CSSProperties = {
  width: 'min(440px, 92vw)',
  padding: 16,
  textAlign: 'left',
};

export function ConfiguredQuickstartPopover({
  workgroupName,
  workgroupSlug,
  tenantToken,
  onClose,
}: ConfiguredQuickstartPopoverProps) {
  const t = useTranslations('workforce');
  const tc = useTranslations('common');
  const [os, setOs] = useState<Os>(detectOs);
  // The write, the 2000ms "Copied!" window and its unmount-safe reset live in the
  // shared hook — this popover is dismissed on any outside click, well inside it.
  const { copied, copy } = useCopyToClipboard();
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

  // A blocked clipboard stays silent as before (the hook's `error` state is unused) —
  // the command stays on screen to select manually.
  const copyCommand = () => { void copy(command); };

  const osBtn = (value: Os): React.CSSProperties => ({
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    background: os === value ? 'var(--accent)' : 'transparent',
    color: os === value ? 'var(--text-on-accent)' : 'var(--text-strong)',
  });

  return (
    <div ref={ref} className="card" style={cardStyle} role="dialog" aria-label={t('quickstart.title')}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>
          {t('quickstart.title')}
        </h4>
        <button
          type="button"
          onClick={onClose}
          aria-label={tc('close')}
          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
        >
          ×
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>
        {t.rich('quickstart.intro', {
          name: workgroupName,
          b: (chunks) => <strong style={{ color: 'var(--text-strong)' }}>{chunks}</strong>,
        })}
      </p>

      {/* OS toggle */}
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 10 }}>
        <button type="button" style={osBtn('unix')} onClick={() => setOs('unix')}>{t('quickstart.osUnix')}</button>
        <button type="button" style={osBtn('windows')} onClick={() => setOs('windows')}>{t('quickstart.osWindows')}</button>
      </div>

      {/* Command block */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          padding: '10px 12px',
        }}
      >
        <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-strong)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {command}
        </code>
        <button
          type="button"
          onClick={copyCommand}
          style={{
            flexShrink: 0, padding: '4px 10px', fontSize: 12, fontWeight: 600,
            background: copied ? 'var(--surface-coral-soft)' : 'var(--accent)',
            color: copied ? 'var(--accent)' : 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          }}
        >
          {copied ? t('copiedExclaim') : tc('copy')}
        </button>
      </div>

      {!tenantToken && (
        <p style={{ fontSize: 11, color: 'var(--error-text)', margin: '10px 0 0' }}>
          {t('quickstart.noToken')}
        </p>
      )}
    </div>
  );
}
