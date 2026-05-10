'use client';

import { useState } from 'react';

/**
 * Shared "save this key now" banner used by both the owner self-service mint
 * page (`/settings/api-keys`) and the superadmin mint-on-behalf admin tab.
 *
 * Single source of truth for the post-mint UX: the raw key (shown once),
 * the gateway base URL the caller needs to point their SDK at, and a
 * copy-paste quickstart snippet using the actual @seanhogg/builderforce-sdk
 * surface. Both consumers render this exactly the same way — no per-screen
 * variation in what's shown after a successful mint.
 */

const BUILDERFORCE_BASE_URL = 'https://api.builderforce.ai';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--coral-bright, #f4726e)',
  borderRadius: 12,
  padding: 20,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginTop: 12,
  marginBottom: 4,
};

const codeBox: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  padding: '10px 12px',
  background: 'var(--bg-elevated)',
  borderRadius: 8,
  wordBreak: 'break-all',
  border: '1px solid var(--border-subtle)',
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  background: 'var(--surface-interactive)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  cursor: 'pointer',
};

interface Props {
  /** The raw `bfk_*` key returned by the mint endpoint — shown once, never persisted client-side. */
  rawKey: string;
  /** The display name the user gave the key. */
  name: string;
  /** Caller's dismiss callback — closes the banner. */
  onDismiss: () => void;
}

export function MintedTenantApiKeyDisplay({ rawKey, name, onDismiss }: Props) {
  const [copied, setCopied] = useState<'key' | 'url' | 'snippet' | null>(null);

  const copy = (what: 'key' | 'url' | 'snippet', text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const snippet = `import { BuilderforceClient } from '@seanhogg/builderforce-sdk';

const client = new BuilderforceClient({
  apiKey:  process.env.BUILDERFORCE_API_KEY!,
  baseUrl: process.env.BUILDERFORCE_BASE_URL ?? '${BUILDERFORCE_BASE_URL}',
});`;

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
        Save this key now — it will not be shown again
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{name}</div>

      <div style={labelStyle}>BUILDERFORCE_API_KEY</div>
      <div style={codeBox}>{rawKey}</div>

      <div style={labelStyle}>BUILDERFORCE_BASE_URL</div>
      <div style={codeBox}>{BUILDERFORCE_BASE_URL}</div>

      <div style={labelStyle}>Quickstart</div>
      <pre style={{ ...codeBox, whiteSpace: 'pre-wrap', margin: 0 }}>{snippet}</pre>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => copy('key', rawKey)} style={buttonStyle}>
          {copied === 'key' ? '✓ Copied' : 'Copy key'}
        </button>
        <button type="button" onClick={() => copy('url', BUILDERFORCE_BASE_URL)} style={buttonStyle}>
          {copied === 'url' ? '✓ Copied' : 'Copy base URL'}
        </button>
        <button type="button" onClick={() => copy('snippet', snippet)} style={buttonStyle}>
          {copied === 'snippet' ? '✓ Copied' : 'Copy quickstart'}
        </button>
        <button type="button" onClick={onDismiss} style={{ ...buttonStyle, background: 'none' }}>
          I&apos;ve saved it
        </button>
      </div>
    </div>
  );
}
