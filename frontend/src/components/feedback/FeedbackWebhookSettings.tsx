'use client';

/**
 * Provider webhook setup — import requests a team already gathers in Sentry or
 * PostHog instead of asking them to re-instrument their product with our snippet.
 *
 * Three things an operator needs and cannot get anywhere else, so all three live
 * on one card: the URL to paste into the provider, the signing secret (shown ONCE
 * — the server never returns it again, only rotates it), and the header name the
 * provider must sign with. Splitting them across surfaces is how a half-configured
 * integration silently rejects every delivery with nothing on screen to explain it.
 *
 * The provider list is served by the API from its adapter registry rather than
 * hard-coded here, so this picker can never offer a provider with no adapter behind
 * it. Rotating replaces the secret in place: connecting an already-connected
 * provider IS the rotate, because a separate button would let a re-connect no-op
 * while the operator pasted a fresh value into the provider's console.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { useConfirm } from '@/components/ConfirmProvider';
import { AUTH_API_URL } from '@/lib/auth';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { useFormat } from '@/i18n/useFormat';
import {
  feedbackApi,
  type ConnectFeedbackIntegrationResult,
  type FeedbackIntegration,
  type FeedbackProviderOption,
} from '@/lib/feedbackApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 20,
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 'var(--font-size-body)', fontWeight: 600, background: 'var(--coral-bright)',
  color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const pre: React.CSSProperties = {
  background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
  padding: 12, fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', overflowX: 'auto',
  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};
const sectionTitle: React.CSSProperties = { fontWeight: 600, fontSize: 'var(--font-size-card-title)', marginBottom: 8 };
const selectStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 'var(--font-size-body)', borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-deep)', color: 'var(--text-primary)',
  flex: '1 1 160px', minWidth: 0,
};

/** Absolute URL an operator pastes into the provider — the API serves a path. */
function absoluteWebhookUrl(path: string): string {
  return `${AUTH_API_URL}${path}`;
}

export function FeedbackWebhookSettings({ collectorId }: { collectorId: string }) {
  const t = useTranslations('feedback');
  const confirm = useConfirm();
  const [providers, setProviders] = useState<FeedbackProviderOption[]>([]);
  const [integrations, setIntegrations] = useState<FeedbackIntegration[]>([]);
  const [choice, setChoice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<ConnectFeedbackIntegrationResult | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    feedbackApi.integrations.list(collectorId)
      .then((r) => {
        setProviders(r.providers);
        setIntegrations(r.integrations);
        setChoice((prev) => prev || r.providers[0]?.id || '');
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('webhooks.loadFailed')))
      .finally(() => setLoading(false));
  }, [collectorId, t]);
  useEffect(() => { load(); }, [load]);

  const connect = async (provider: string) => {
    setBusy(true); setError(null);
    try {
      setRevealed(await feedbackApi.integrations.connect(collectorId, provider));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('webhooks.connectFailed'));
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (provider: string, enabled: boolean) => {
    setBusy(true); setError(null);
    try { await feedbackApi.integrations.setEnabled(collectorId, provider, enabled); load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('webhooks.saveFailed')); }
    finally { setBusy(false); }
  };

  const disconnect = async (provider: string) => {
    if (!(await confirm(t('webhooks.confirmDisconnect')))) return;
    setBusy(true); setError(null);
    try { await feedbackApi.integrations.disconnect(collectorId, provider); load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('webhooks.saveFailed')); }
    finally { setBusy(false); }
  };

  const labelFor = (id: string) => providers.find((p) => p.id === id)?.label ?? id;
  const unconnected = providers.filter((p) => !integrations.some((i) => i.provider === p.id));

  return (
    <RoleGate capability="quality.manageSources">
      <div style={card}>
        <div style={sectionTitle}>{t('webhooks.title')}</div>
        <div style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)' }}>{t('webhooks.intro')}</div>

        {error && <div role="alert" style={{ fontSize: 'var(--font-size-body)', color: 'var(--danger)', marginTop: 10 }}>{error}</div>}

        {revealed && (
          <RevealedSecret
            revealed={revealed}
            label={labelFor(revealed.provider)}
            onDismiss={() => setRevealed(null)}
          />
        )}

        {loading ? (
          <div style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', marginTop: 12 }}>{t('webhooks.loading')}</div>
        ) : (
          <>
            {integrations.map((integration) => (
              <IntegrationRow
                key={integration.provider}
                integration={integration}
                label={labelFor(integration.provider)}
                busy={busy}
                onRotate={() => connect(integration.provider)}
                onToggle={() => setEnabled(integration.provider, !integration.enabled)}
                onDisconnect={() => disconnect(integration.provider)}
              />
            ))}

            {integrations.length === 0 && (
              <div style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', marginTop: 12 }}>{t('webhooks.none')}</div>
            )}

            {unconnected.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <Select
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                  aria-label={t('webhooks.provider')}
                  style={selectStyle}
                >
                  {unconnected.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </Select>
                <button
                  type="button"
                  style={btnPrimary}
                  disabled={busy || !choice}
                  onClick={() => connect(choice || unconnected[0]!.id)}
                >
                  {busy ? t('webhooks.connecting') : t('webhooks.connect')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </RoleGate>
  );
}

function IntegrationRow({ integration, label, busy, onRotate, onToggle, onDisconnect }: {
  integration: FeedbackIntegration;
  label: string;
  busy: boolean;
  onRotate: () => void;
  onToggle: () => void;
  onDisconnect: () => void;
}) {
  const t = useTranslations('feedback');
  const fmt = useFormat();
  return (
    <div style={{
      marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 'var(--font-size-card-title)', flex: '1 1 160px', minWidth: 0 }}>
          {label}
          <span style={{ marginLeft: 8, fontSize: 'var(--font-size-eyebrow)', fontWeight: 400, color: 'var(--text-muted)' }}>
            {integration.enabled ? t('webhooks.active') : t('webhooks.paused')}
            {integration.lastEventAt ? ` · ${t('webhooks.lastEvent')} ${fmt.dateTime(integration.lastEventAt)}` : ''}
          </span>
        </span>
        <button type="button" style={btnSubtle} disabled={busy} onClick={onToggle}>
          {integration.enabled ? t('webhooks.pause') : t('webhooks.resume')}
        </button>
        <button type="button" style={btnSubtle} disabled={busy} onClick={onRotate}>
          {t('webhooks.rotate')}
        </button>
        <button type="button" style={{ ...btnSubtle, color: 'var(--danger)' }} disabled={busy} onClick={onDisconnect}>
          {t('webhooks.disconnect')}
        </button>
      </div>

      {/* A connected integration with no secret rejects EVERY delivery. Say so
          here rather than leaving the operator to read a 409 in a provider log. */}
      {!integration.hasSecret && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-small)',
          background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', color: 'var(--warning)',
        }}>
          {t('webhooks.noSecret')}
        </div>
      )}

      <CopyBlock label={t('webhooks.url')} value={absoluteWebhookUrl(integration.webhookUrl)} />
    </div>
  );
}

function RevealedSecret({ revealed, label, onDismiss }: {
  revealed: ConnectFeedbackIntegrationResult;
  label: string;
  onDismiss: () => void;
}) {
  const t = useTranslations('feedback');
  return (
    <div style={{
      ...card, marginTop: 12, padding: 16, border: '1px solid var(--coral-bright)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 'var(--font-size-card-title)' }}>{t('webhooks.connected', { provider: label })}</div>
        <button type="button" style={btnSubtle} onClick={onDismiss}>{t('setup.dismiss')}</button>
      </div>
      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 4 }}>
        {t('webhooks.secretOnce', { header: revealed.signatureHeader })}
      </div>
      <CopyBlock label={t('webhooks.secret')} value={revealed.secret} />
      <CopyBlock label={t('webhooks.url')} value={absoluteWebhookUrl(revealed.webhookUrl)} />
    </div>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const t = useTranslations('feedback');
  const { copied, copy: copyValue } = useCopyToClipboard(1500);
  const copy = () => { void copyValue(value); };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8 }}>
        <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
        <button type="button" style={btnSubtle} onClick={copy} aria-label={t('setup.copy')}>{copied ? '✓' : '⧉'}</button>
      </div>
      <pre style={pre}>{value}</pre>
    </div>
  );
}
