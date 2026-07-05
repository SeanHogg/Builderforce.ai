'use client';

import { useEffect, useState } from 'react';
import { providerKeysApi, type ProviderAuthType, type LlmProvider } from '@/lib/builderforceApi';

/**
 * BYO (bring-your-own-provider) credentials. A workspace owner connects their OWN
 * frontier-model accounts — Anthropic, OpenAI, and/or Google — and the platform
 * routes calls through the tenant's account instead of Builderforce's metered pool.
 * Connecting a provider unlocks that provider's models in every picker and (for a
 * free plan) unlocks model choice; own-machine (on-prem/VSIX) usage is then free,
 * cloud-agent usage is still charged.
 *
 * ONE shared {@link ProviderConnectionCard} renders each provider — the provider
 * config drives the differences (Anthropic also offers a Pro/Max SUBSCRIPTION via
 * OAuth; OpenAI/Google are API-key only). Secrets are write-only: we only show
 * whether/how a credential is configured, never the value.
 *
 * NOTE: this surface (the /settings/api-keys page) is not yet wired to next-intl;
 * strings stay in English to match the surrounding page. Localization of the whole
 * api-keys surface is tracked in the roadmap.
 */

interface ProviderConfig {
  id: LlmProvider;
  /** Display name of the provider. */
  label: string;
  /** What the user's own account powers, shown in the card blurb. */
  blurb: string;
  /** Placeholder / format hint for the API-key input. */
  keyPlaceholder: string;
  /** Anthropic also supports connecting a Pro/Max subscription via OAuth. */
  supportsOauth: boolean;
  /** Label for the connected-subscription state (OAuth providers only). */
  subscriptionLabel?: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    blurb: 'Connect your Claude Pro/Max subscription (no per-token billing) or paste an Anthropic API key.',
    keyPlaceholder: 'sk-ant-…',
    supportsOauth: true,
    subscriptionLabel: 'Claude subscription',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    blurb: 'Paste an OpenAI API key to run GPT models on your own OpenAI account.',
    keyPlaceholder: 'sk-…',
    supportsOauth: false,
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    blurb: 'Paste a Google AI (Gemini) API key to run Gemini models on your own Google account.',
    keyPlaceholder: 'AIza…',
    supportsOauth: false,
  },
];

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};
const wrapStyle: React.CSSProperties = {
  display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
};
const sectionTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8,
  boxSizing: 'border-box', fontFamily: 'var(--font-mono)', minWidth: 0,
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
  display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
};
const dividerLine: React.CSSProperties = { flex: 1, height: 1, background: 'var(--border-subtle)' };

/**
 * One provider's connect card. Owns its own draft/busy/connect state and decides
 * its own UI from the provider config (OAuth block only when supported). Reports
 * the resolved auth type up so the parent's status stays in one place.
 */
function ProviderConnectionCard({
  config,
  authType,
  onChange,
}: {
  config: ProviderConfig;
  authType: ProviderAuthType | null; // null = nothing configured
  onChange: (authType: ProviderAuthType | null) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pastedCode, setPastedCode] = useState('');

  const configured = authType !== null;

  const saveKey = async () => {
    const apiKey = draft.trim();
    if (!apiKey) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.set(config.id, apiKey);
      onChange('api_key');
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
      onChange('oauth');
      setConnecting(false);
      setPastedCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect subscription');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const what = authType === 'oauth'
      ? `Disconnect your ${config.subscriptionLabel ?? config.label}`
      : `Remove your ${config.label} API key`;
    if (!confirm(`${what}? Agents using it will fall back to Builderforce's managed models.`)) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.remove(config.id);
      onChange(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove credential');
    } finally {
      setBusy(false);
    }
  };

  const statusLabel =
    authType === 'oauth' ? `● ${config.subscriptionLabel ?? config.label} connected`
    : authType === 'api_key' ? `● ${config.label} API key configured`
    : `○ Not connected`;

  return (
    <div style={cardStyle}>
      <div style={sectionTitle}>{config.label}</div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>{config.blurb}</p>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>Error: {error}</div>}

      <div style={{ fontSize: 12, fontWeight: 600, color: configured ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span>{statusLabel}</span>
        {configured && (
          <button type="button" onClick={remove} disabled={busy} style={{ ...buttonDanger, padding: '2px 10px' }}>
            {authType === 'oauth' ? 'Disconnect' : 'Remove'}
          </button>
        )}
      </div>

      {/* ── Subscription connect (OAuth) — Anthropic only ─────────────────── */}
      {config.supportsOauth && (
        <>
          {!connecting ? (
            <button type="button" onClick={startConnect} disabled={busy} style={{ ...buttonPrimary, opacity: busy ? 0.5 : 1 }}>
              {busy ? 'Working…' : authType === 'oauth' ? `Reconnect ${config.subscriptionLabel}` : `Connect ${config.subscriptionLabel}`}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Approved in the Claude tab? Paste the code it shows you (the full <code>code#state</code> value) below.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={pastedCode}
                  onChange={(e) => setPastedCode(e.target.value)}
                  placeholder="Paste code from Claude…"
                  disabled={busy}
                  style={{ ...inputStyle, flex: '1 1 180px' }}
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
            Connect only your <strong style={{ color: 'var(--text-primary)' }}>own</strong> account — a subscription
            credential is personal and must not be shared across workspaces.
          </p>
          <div style={dividerRow}><div style={dividerLine} /> OR USE AN API KEY <div style={dividerLine} /></div>
        </>
      )}

      {/* ── API key ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={authType === 'api_key' ? `Replace key (${config.keyPlaceholder})` : config.keyPlaceholder}
          disabled={busy}
          style={{ ...inputStyle, flex: '1 1 180px' }}
        />
        <button type="button" onClick={saveKey} disabled={busy || !draft.trim()} style={{ ...buttonPrimary, opacity: busy || !draft.trim() ? 0.5 : 1, flexShrink: 0 }}>
          {busy ? 'Saving…' : authType === 'api_key' ? 'Replace' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export function ProviderKeysSettings() {
  const [authByProvider, setAuthByProvider] = useState<Partial<Record<LlmProvider, ProviderAuthType>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    providerKeysApi.list()
      .then((r) => {
        const map: Partial<Record<LlmProvider, ProviderAuthType>> = {};
        for (const d of r.details) map[d.provider] = d.authType;
        setAuthByProvider(map);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => { void refresh(); }, []);

  return (
    <div>
      <div style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Bring your own models</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Connect your own Anthropic, OpenAI, or Google account. Connected providers power your agents on your own
        account and drive the model choices in every picker — usage on your machine (on-prem &amp; VS Code) is free;
        cloud-agent usage is still billed. Credentials are stored encrypted and never shown again.
      </p>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>Error: {error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <div style={wrapStyle}>
          {PROVIDERS.map((p) => (
            <ProviderConnectionCard
              key={p.id}
              config={p}
              authType={authByProvider[p.id] ?? null}
              onChange={(authType) =>
                setAuthByProvider((prev) => {
                  const next = { ...prev };
                  if (authType === null) delete next[p.id];
                  else next[p.id] = authType;
                  return next;
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
