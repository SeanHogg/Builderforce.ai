'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
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
 * whether/how a credential is configured, never the value. Fully localized under
 * the `providerKeys` namespace; brand names + key formats stay literal.
 */

interface ProviderConfig {
  id: LlmProvider;
  /** Display name of the provider — a brand, kept literal (not translated). */
  label: string;
  /** Placeholder / format hint for the API-key input — literal. */
  keyPlaceholder: string;
  /** Provider supports connecting a consumer subscription via OAuth. */
  supportsOauth: boolean;
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', keyPlaceholder: 'sk-ant-…', supportsOauth: true },
  { id: 'openai',    label: 'OpenAI',             keyPlaceholder: 'sk-…',     supportsOauth: true },
  { id: 'google',    label: 'Google (Gemini)',    keyPlaceholder: 'AIza…',   supportsOauth: false },
  { id: 'meta',      label: 'Meta AI (MUSE)',     keyPlaceholder: 'meta-…',  supportsOauth: false },
  { id: 'kimi',      label: 'Kimi',                keyPlaceholder: 'sk-…',    supportsOauth: false },
  { id: 'qwen',      label: 'Qwen',                keyPlaceholder: 'sk-…',    supportsOauth: false },
  { id: 'minimax',   label: 'MiniMax',             keyPlaceholder: 'sk-…',    supportsOauth: false },
  { id: 'xai',       label: 'xAI (Grok)',           keyPlaceholder: 'xai-…',   supportsOauth: true },
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

type TFn = ReturnType<typeof useTranslations>;

/** Provider display label by id — literal brand names (not translated). */
const PROVIDER_LABEL: Record<LlmProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  google: 'Google (Gemini)',
  meta: 'Meta AI (MUSE)',
  kimi: 'Kimi',
  qwen: 'Qwen',
  minimax: 'MiniMax',
  xai: 'xAI (Grok)',
};

/**
 * BYO PRECEDENCE — the ordered list (most-preferred first) the auto-select cloud pin
 * leads its connected flagships by. Shown only when 2+ providers are connected (order
 * is moot with one). Reordering persists the whole list via `setPriority`, so an owner
 * at their Anthropic quota can put **Meta first** and have cloud agents route there.
 */
function PrecedencePanel({
  order,
  onReorder,
  t,
}: {
  order: LlmProvider[];
  onReorder: (next: LlmProvider[]) => void;
  t: TFn;
}) {
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 20 }}>
      <div style={sectionTitle}>{t('precedence.title')}</div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>{t('precedence.subtitle')}</p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {order.map((p, i) => (
          <li
            key={p}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', minWidth: 18, textAlign: 'center' }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 0 }}>{PROVIDER_LABEL[p]}</span>
            {i === 0 && (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(34,197,94,0.9)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {t('precedence.leads')}
              </span>
            )}
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label={t('precedence.moveUp', { provider: PROVIDER_LABEL[p] })}
              style={{ ...buttonPrimary, padding: '2px 9px', opacity: i === 0 ? 0.4 : 1 }}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === order.length - 1}
              aria-label={t('precedence.moveDown', { provider: PROVIDER_LABEL[p] })}
              style={{ ...buttonPrimary, padding: '2px 9px', opacity: i === order.length - 1 ? 0.4 : 1 }}
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * One provider's connect card. Owns its own draft/busy/connect state and decides
 * its own UI from the provider config (OAuth block only when supported). Reports
 * the resolved auth type up so the parent's status stays in one place.
 */
function ProviderConnectionCard({
  config,
  authType,
  onChange,
  t,
}: {
  config: ProviderConfig;
  authType: ProviderAuthType | null; // null = nothing configured
  onChange: (authType: ProviderAuthType | null) => void;
  t: TFn;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pastedCode, setPastedCode] = useState('');
  const confirm = useConfirm();

  const configured = authType !== null;
  const blurb = t(`provider.${config.id}.blurb`);
  const subscription = config.supportsOauth ? t(`provider.${config.id}.subscription`) : '';

  const saveKey = async () => {
    const apiKey = draft.trim();
    if (!apiKey) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.set(config.id, apiKey);
      onChange('api_key');
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errSaveKey'));
    } finally {
      setBusy(false);
    }
  };

  const startConnect = async () => {
    setBusy(true); setError(null);
    try {
      const { authorizeUrl } = await providerKeysApi.oauthStart(config.id);
      window.open(authorizeUrl, '_blank', 'noopener,noreferrer');
      setConnecting(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errStartConnect'));
    } finally {
      setBusy(false);
    }
  };

  const finishConnect = async () => {
    const code = pastedCode.trim();
    if (!code) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.oauthComplete(config.id, code);
      onChange('oauth');
      setConnecting(false);
      setPastedCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errConnectSubscription'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const msg = authType === 'oauth'
      ? t('confirmRemoveSubscription', { subscription })
      : t('confirmRemoveKey', { label: config.label });
    if (!(await confirm(msg))) return;
    setBusy(true); setError(null);
    try {
      await providerKeysApi.remove(config.id);
      onChange(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errRemove'));
    } finally {
      setBusy(false);
    }
  };

  const statusLabel =
    authType === 'oauth' ? t('status.connected', { subscription })
    : authType === 'api_key' ? t('status.keyConfigured', { label: config.label })
    : t('status.notConnected');

  return (
    <div style={cardStyle}>
      <div style={sectionTitle}>{config.label}</div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>{blurb}</p>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>{t('errorPrefix', { message: error })}</div>}

      <div style={{ fontSize: 12, fontWeight: 600, color: configured ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span>{statusLabel}</span>
        {configured && (
          <button type="button" onClick={remove} disabled={busy} style={{ ...buttonDanger, padding: '2px 10px' }}>
            {authType === 'oauth' ? t('disconnect') : t('remove')}
          </button>
        )}
      </div>

      {/* ── Subscription connect (OAuth) — Anthropic only ─────────────────── */}
      {config.supportsOauth && (
        <>
          {!connecting ? (
            <button type="button" onClick={startConnect} disabled={busy} style={{ ...buttonPrimary, opacity: busy ? 0.5 : 1 }}>
              {busy ? t('working') : authType === 'oauth' ? t('reconnect', { subscription }) : t('connect', { subscription })}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                {t.rich(`provider.${config.id}.pastePrompt`, { code: (chunks) => <code>{chunks}</code> })}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={pastedCode}
                  onChange={(e) => setPastedCode(e.target.value)}
                  placeholder={t(`provider.${config.id}.pastePlaceholder`)}
                  disabled={busy}
                  style={{ ...inputStyle, flex: '1 1 180px' }}
                />
                <button type="button" onClick={finishConnect} disabled={busy || !pastedCode.trim()} style={{ ...buttonPrimary, opacity: busy || !pastedCode.trim() ? 0.5 : 1, flexShrink: 0 }}>
                  {busy ? t('connecting') : t('finish')}
                </button>
                <button type="button" onClick={() => { setConnecting(false); setPastedCode(''); }} disabled={busy} style={{ ...buttonDanger, flexShrink: 0 }}>
                  {t('cancel')}
                </button>
              </div>
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
            {t.rich('ownAccountNote', { b: (chunks) => <strong style={{ color: 'var(--text-primary)' }}>{chunks}</strong> })}
          </p>
          <div style={dividerRow}><div style={dividerLine} /> {t('orUseApiKey')} <div style={dividerLine} /></div>
        </>
      )}

      {/* ── API key ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={authType === 'api_key' ? t('keyPlaceholderReplace', { placeholder: config.keyPlaceholder }) : config.keyPlaceholder}
          disabled={busy}
          style={{ ...inputStyle, flex: '1 1 180px' }}
        />
        <button type="button" onClick={saveKey} disabled={busy || !draft.trim()} style={{ ...buttonPrimary, opacity: busy || !draft.trim() ? 0.5 : 1, flexShrink: 0 }}>
          {busy ? t('saving') : authType === 'api_key' ? t('replace') : t('save')}
        </button>
      </div>
    </div>
  );
}

export function ProviderKeysSettings() {
  const t = useTranslations('providerKeys');
  const [authByProvider, setAuthByProvider] = useState<Partial<Record<LlmProvider, ProviderAuthType>>>({});
  // BYO precedence — connected providers, most-preferred first. Seeded from the backend
  // order (priority asc, unset last), then kept in sync as providers connect/disconnect.
  const [order, setOrder] = useState<LlmProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    providerKeysApi.list()
      .then((r) => {
        const map: Partial<Record<LlmProvider, ProviderAuthType>> = {};
        for (const d of r.details) map[d.provider] = d.authType;
        setAuthByProvider(map);
        // r.details already arrives ordered by tenant precedence — connected only.
        setOrder(r.details.map((d) => d.provider));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => { void refresh(); }, []);

  // Reflect a connect/disconnect in the precedence list: append a newly-connected
  // provider to the tail (lowest precedence until reordered), drop a removed one.
  const syncOrder = (provider: LlmProvider, authType: ProviderAuthType | null) =>
    setOrder((prev) =>
      authType === null ? prev.filter((p) => p !== provider)
      : prev.includes(provider) ? prev
      : [...prev, provider],
    );

  const persistOrder = async (next: LlmProvider[]) => {
    setOrder(next); // optimistic
    try {
      await providerKeysApi.setPriority(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('precedence.errSave'));
    }
  };

  return (
    <div>
      <div style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>{t('title')}</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>{t('subtitle')}</p>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>{t('errorPrefix', { message: error })}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : (
        <>
          {order.length >= 2 && <PrecedencePanel order={order} onReorder={persistOrder} t={t} />}
          <div style={wrapStyle}>
            {PROVIDERS.map((p) => (
              <ProviderConnectionCard
                key={p.id}
                config={p}
                authType={authByProvider[p.id] ?? null}
                t={t}
                onChange={(authType) => {
                  setAuthByProvider((prev) => {
                    const next = { ...prev };
                    if (authType === null) delete next[p.id];
                    else next[p.id] = authType;
                    return next;
                  });
                  syncOrder(p.id, authType);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
