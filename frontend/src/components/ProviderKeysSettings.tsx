'use client';

import { useEffect, useState } from 'react';
import { providerKeysApi } from '@/lib/builderforceApi';

/**
 * BYO LLM provider keys card. Lets the workspace owner store their own Anthropic
 * API key, which the gateway uses to run BuilderForce-V2 (Claude Agent SDK)
 * agents and meters on the workspace ledger. The key is write-only — we only
 * show whether one is configured, never the secret. Self-contained: owns its
 * own load + visibility, so the host page just mounts it.
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

export function ProviderKeysSettings() {
  const [hasAnthropic, setHasAnthropic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    providerKeysApi.list()
      .then((r) => setHasAnthropic(r.providers.includes('anthropic')))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    const apiKey = draft.trim();
    if (!apiKey) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.set('anthropic', apiKey);
      setHasAnthropic(true);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save key');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Remove your Anthropic API key? BuilderForce-V2 agents will stop running until you add a new one.')) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.remove('anthropic');
      setHasAnthropic(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove key');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={cardStyle}>
      <div style={sectionTitle}>Bring your own Anthropic key</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Stored encrypted and used to run <strong style={{ color: 'var(--text-primary)' }}>BuilderForce-V2 (Claude Agent SDK)</strong> agents
        through the gateway. Usage is metered on this workspace. The key is write-only — it’s never shown again after you save it.
      </p>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>Error: {error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: hasAnthropic ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)', marginBottom: 10 }}>
            {hasAnthropic ? '● Anthropic key configured' : '○ No Anthropic key configured'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={hasAnthropic ? 'Replace key (sk-ant-…)' : 'sk-ant-…'}
              disabled={busy}
              style={inputStyle}
            />
            <button type="button" onClick={save} disabled={busy || !draft.trim()} style={{ ...buttonPrimary, opacity: busy || !draft.trim() ? 0.5 : 1, flexShrink: 0 }}>
              {busy ? 'Saving…' : hasAnthropic ? 'Replace' : 'Save'}
            </button>
            {hasAnthropic && (
              <button type="button" onClick={remove} disabled={busy} style={{ ...buttonDanger, flexShrink: 0 }}>
                Remove
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
