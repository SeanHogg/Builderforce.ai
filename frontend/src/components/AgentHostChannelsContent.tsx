'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { channelsApi, type AgentHostChannel, type ChannelPlatform } from '@/lib/builderforceApi';

/**
 * Where an agent host speaks — the panel over `agent_host_channels`.
 *
 * It shipped against an endpoint that answered a hardcoded empty list, so the
 * list never filled and add/toggle/delete answered 404. Now that the registry is
 * real, two things follow that the old version could not have:
 *
 *   · the config field is WRITE-ONLY. The server seals a token or webhook URL and
 *     never sends it back, so this shows whether one is stored, not what it is.
 *     A panel that round-tripped the value would put a live credential in the
 *     browser and in every log line that recorded the response.
 *   · a channel carries the HOST's own verdict (`lastStatus`), because "configured"
 *     and "actually connected" are different facts and only the host knows the
 *     second one.
 */

interface AgentHostChannelsContentProps {
  agentHostId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

const PLATFORM_ICONS: Record<ChannelPlatform, string> = {
  whatsapp: '📱',
  telegram: '✈️',
  slack: '#',
  discord: '🎮',
  google_chat: '💬',
  signal: '🔐',
  teams: '📊',
  webhook: '🔗',
};

/** Product names, not translated — a Slack is a Slack in every locale. */
const PLATFORM_LABELS: Record<ChannelPlatform, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  slack: 'Slack',
  discord: 'Discord',
  google_chat: 'Google Chat',
  signal: 'Signal',
  teams: 'Microsoft Teams',
  webhook: 'Webhook',
};

const ALL_PLATFORMS: ChannelPlatform[] = [
  'slack', 'discord', 'telegram', 'whatsapp', 'teams', 'google_chat', 'signal', 'webhook',
];

export function AgentHostChannelsContent({ agentHostId }: AgentHostChannelsContentProps) {
  const t = useTranslations('agentHostChannels');
  const [channels, setChannels] = useState<AgentHostChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<{ platform: ChannelPlatform; name: string; config: string }>({
    platform: 'slack',
    name: '',
    config: '',
  });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    channelsApi
      .list(agentHostId)
      .then(setChannels)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentHostId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const ch = await channelsApi.create(agentHostId, {
        platform: form.platform,
        name: form.name.trim(),
        config: form.config.trim() || undefined,
        enabled: true,
      });
      setChannels((prev) => [...prev, ch]);
      setShowAdd(false);
      setForm({ platform: 'slack', name: '', config: '' });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('addFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (ch: AgentHostChannel) => {
    setBusyId(ch.id);
    setError(null);
    try {
      const updated = await channelsApi.update(agentHostId, ch.id, { enabled: !ch.enabled });
      setChannels((prev) => prev.map((c) => (c.id === ch.id ? updated : c)));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('updateFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (channelId: string) => {
    setBusyId(channelId);
    setError(null);
    try {
      await channelsApi.delete(agentHostId, channelId);
      setChannels((prev) => prev.filter((c) => c.id !== channelId));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('deleteFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const configPlaceholder = form.platform === 'webhook'
    ? t('configWebhook')
    : form.platform === 'slack'
      ? t('configSlack')
      : t('configGeneric');

  if (loading) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('heading', { count: channels.length })}
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            background: showAdd ? 'var(--bg-base)' : 'var(--surface-interactive)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            minHeight: 32,
          }}
        >
          {showAdd ? t('cancel') : t('addChannel')}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>{error}</div>
      )}

      {showAdd && (
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t('newChannel')}</div>
          <div
            role="radiogroup"
            aria-label={t('platformLabel')}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 8 }}
          >
            {ALL_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={form.platform === p}
                onClick={() => setForm((f) => ({ ...f, platform: p }))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: form.platform === p ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))' : 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: `1px solid ${form.platform === p ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  minHeight: 36,
                }}
              >
                <span aria-hidden="true">{PLATFORM_ICONS[p]}</span>
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
          <input
            type="text"
            aria-label={t('nameLabel')}
            placeholder={t('namePlaceholder')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            style={{
              padding: '8px 12px',
              fontSize: 13,
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              minWidth: 0,
            }}
          />
          <textarea
            aria-label={t('configLabel')}
            placeholder={configPlaceholder}
            value={form.config}
            onChange={(e) => setForm((f) => ({ ...f, config: e.target.value }))}
            rows={3}
            style={{
              padding: '8px 12px',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              resize: 'vertical',
              minWidth: 0,
            }}
          />
          {/* Said out loud, because the field never shows its value again. */}
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>{t('configSealedHint')}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!form.name.trim() || saving}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: 'var(--coral-bright)',
                color: 'var(--text-on-accent)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: !form.name.trim() || saving ? 'not-allowed' : 'pointer',
                opacity: !form.name.trim() || saving ? 0.5 : 1,
                minHeight: 36,
              }}
            >
              {saving ? t('adding') : t('addChannelConfirm')}
            </button>
          </div>
        </div>
      )}

      {channels.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          {t('empty')}
        </div>
      ) : (
        channels.map((ch) => (
          <div key={ch.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span aria-hidden="true" style={{ fontSize: 20, flexShrink: 0 }}>{PLATFORM_ICONS[ch.platform]}</span>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                {ch.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {PLATFORM_LABELS[ch.platform]}
                {' · '}
                {ch.configured ? t('configured') : t('notConfigured')}
                {ch.lastStatus ? ` · ${t('hostStatus', { status: ch.lastStatus })}` : ''}
              </div>
              {ch.lastError && (
                <div style={{ fontSize: 11, color: 'var(--coral-bright)', marginTop: 2, wordBreak: 'break-word' }}>
                  {ch.lastError}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleToggle(ch)}
              disabled={busyId === ch.id}
              aria-pressed={ch.enabled}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: ch.enabled ? 'var(--surface-cyan-soft, rgba(0,229,204,0.15))' : 'var(--bg-elevated)',
                color: ch.enabled ? 'var(--cyan-bright)' : 'var(--text-muted)',
                border: `1px solid ${ch.enabled ? 'var(--cyan-bright)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-sm)',
                cursor: busyId === ch.id ? 'wait' : 'pointer',
                flexShrink: 0,
                minHeight: 28,
              }}
            >
              {busyId === ch.id ? t('working') : ch.enabled ? t('enabled') : t('disabled')}
            </button>
            <button
              type="button"
              onClick={() => handleDelete(ch.id)}
              disabled={busyId === ch.id}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: 'none',
                color: 'var(--coral-bright)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                cursor: busyId === ch.id ? 'wait' : 'pointer',
                flexShrink: 0,
                minHeight: 28,
              }}
            >
              {busyId === ch.id ? t('working') : t('delete')}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
