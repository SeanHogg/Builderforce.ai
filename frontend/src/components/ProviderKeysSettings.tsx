'use client';

import { useEffect, useState } from 'react';
import { providerKeysApi, type ProviderAuthType } from '@/lib/builderforceApi';

/**
 * BYO Anthropic auth card. The workspace owner can power BuilderForce-V2 (Claude
 * Agent SDK) agents either by:
 *   • pasting an Anthropic API key (metered per token), or
 *   • connecting their own Claude Pro/Max SUBSCRIPTION (OAuth) — no per-token
 *     billing; runs ride on the connected Claude account.
 * Secrets are write-only — we only show whether/how a credential is configured,
 * never the value. Self-contained: owns its own load + visibility.
 *
 * POLICY: a subscription token is your OWN personal Claude credential. Connect
 * only your own account — it must not be shared or resold across tenants.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8,
  boxSizing: 'border-box', fontFamily: 'var(--font-mono)',
};
const buttonPrimary: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--surface-interactive)',
  color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};
const buttonDanger: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'none',
  color: 'var(--coral-bright, #f4726e)', border: '1px solid var(--coral-bright, #f4726e)', borderRadius: 8, cursor: 'pointer',
};
const dividerRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
};
const dividerLine: React.CSSProperties = { flex: 1, height: 1, background: 'var(--border-subtle)' };

export function ProviderKeysSettings() {
  const [authType, setAuthType] = useState<ProviderAuthType | null>(null); // null = nothing configured
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscription-connect flow: once started we have an authorize URL open and
  // wait for the user to paste back the code Claude shows them.
  const [connecting, setConnecting] = useState(false);
  const [pastedCode, setPastedCode] = useState('');

  const refresh = () =>
    providerKeysApi.list()
      .then((r) => setAuthType(r.details.find((d) => d.provider === 'anthropic')?.authType ?? null))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => { void refresh(); }, []);

  const hasAnthropic = authType !== null;

  const saveKey = async () => {
    const apiKey = draft.trim();
    if (!apiKey) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.set('anthropic', apiKey);
      setAuthType('api_key');
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save key');
    } finally {
      setBusy(false);
    }
  };

  const startConnect = async () => {
    setBusy(true); setError(null);
    try {
      const { authorizeUrl } = await providerKeysApi.oauthStart();
      window.open(authorizeUrl, '_blank', 'noopener,noreferrer');
      setConnecting(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start connect');
    } finally {
      setBusy(false);
    }
  };

  const finishConnect = async () => {
    const code = pastedCode.trim();
    if (!code) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.oauthComplete(code);
      setAuthType('oauth');
      setConnecting(false);
      setPastedCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect subscription');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const what = authType === 'oauth' ? 'Disconnect your Claude subscription' : 'Remove your Anthropic API key';
    if (!confirm(`${what}? BuilderForce-V2 agents will stop running until you reconnect.`)) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.remove('anthropic');
      setAuthType(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove credential');
    } finally {
      setBusy(false);
    }
  };

  const statusLabel =
    authType === 'oauth' ? '● Claude subscription connected'
    : authType === 'api_key' ? '● Anthropic API key configured'
    : '○ No Anthropic credential configured';

  return (
    <div style={cardStyle}>
      <div style={sectionTitle}>Power your agents with Claude</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Connect your own Claude <strong style={{ color: 'var(--text-primary)' }}>Pro/Max subscription</strong> (no
        per-token billing) or paste an Anthropic API key. Either runs your{' '}
        <strong style={{ color: 'var(--text-primary)' }}>BuilderForce-V2 (Claude Agent SDK)</strong> agents through the
        gateway, metered on this workspace. Credentials are stored encrypted and never shown again.
      </p>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>Error: {error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: hasAnthropic ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)', marginBottom: 12 }}>
            {statusLabel}
            {hasAnthropic && (
              <button type="button" onClick={remove} disabled={busy} style={{ ...buttonDanger, marginLeft: 12, padding: '2px 10px' }}>
                {authType === 'oauth' ? 'Disconnect' : 'Remove'}
              </button>
            )}
          </div>

          {/* ── Connect a Claude subscription (OAuth) ─────────────────────── */}
          {!connecting ? (
            <button type="button" onClick={startConnect} disabled={busy} style={{ ...buttonPrimary, opacity: busy ? 0.5 : 1 }}>
              {busy ? 'Working…' : authType === 'oauth' ? 'Reconnect Claude subscription' : 'Connect Claude subscription'}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Approved in the Claude tab? Paste the code it shows you (the full <code>code#state</code> value) below.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={pastedCode}
                  onChange={(e) => setPastedCode(e.target.value)}
                  placeholder="Paste code from Claude…"
                  disabled={busy}
                  style={inputStyle}
                />
                <button type="button" onClick={finishConnect} disabled={busy || !pastedCode.trim()} style={{ ...buttonPrimary, opacity: busy || !pastedCode.trim() ? 0.5 : 1, flexShrink: 0 }}>
                  {busy ? 'Connecting…' : 'Finish'}
                </button>
                <button type="button" onClick={() => { setConnecting(false); setPastedCode(''); }} disabled={busy} style={{ ...buttonDanger, flexShrink: 0 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
            Connect only your <strong style={{ color: 'var(--text-primary)' }}>own</strong> Claude account — a subscription
            credential is personal and must not be shared across workspaces.
          </p>

          {/* ── Or paste an API key ───────────────────────────────────────── */}
          <div style={dividerRow}><div style={dividerLine} /> OR USE AN API KEY <div style={dividerLine} /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={authType === 'api_key' ? 'Replace key (sk-ant-…)' : 'sk-ant-…'}
              disabled={busy}
              style={inputStyle}
            />
            <button type="button" onClick={saveKey} disabled={busy || !draft.trim()} style={{ ...buttonPrimary, opacity: busy || !draft.trim() ? 0.5 : 1, flexShrink: 0 }}>
              {busy ? 'Saving…' : authType === 'api_key' ? 'Replace' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
