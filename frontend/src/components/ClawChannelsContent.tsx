'use client';

import { useState, useEffect } from 'react';
import { channelsApi, type ClawChannel, type ChannelPlatform } from '@/lib/builderforceApi';

interface ClawChannelsContentProps {
  clawId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
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

export function ClawChannelsContent({ clawId }: ClawChannelsContentProps) {
  const [channels, setChannels] = useState<ClawChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<{ platform: ChannelPlatform; name: string; config: string }>({
    platform: 'slack',
    name: '',
    config: '',
  });
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    channelsApi
      .list(clawId)
      .then(setChannels)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [clawId]);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const ch = await channelsApi.create(clawId, {
        platform: form.platform,
        name: form.name.trim(),
        config: form.config.trim() || undefined,
        enabled: true,
      });
      setChannels((prev) => [...prev, ch]);
      setShowAdd(false);
      setForm({ platform: 'slack', name: '', config: '' });
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (ch: ClawChannel) => {
    setTogglingId(ch.id);
    try {
      const updated = await channelsApi.update(clawId, ch.id, { enabled: !ch.enabled });
      setChannels((prev) => prev.map((c) => (c.id === ch.id ? updated : c)));
    } catch {
      // ignore
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (channelId: string) => {
    setDeletingId(channelId);
    try {
      await channelsApi.delete(clawId, channelId);
      setChannels((prev) => prev.filter((c) => c.id !== channelId));
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading channels…</div>;
  if (error) return <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>Error: {error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          Channels ({channels.length})
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
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {showAdd ? 'Cancel' : '+ Add Channel'}
        </button>
      </div>

      {showAdd && (
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>New Channel Integration</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {ALL_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
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
                  border: `1px solid ${form.platform === p ? 'var(--coral-bright, #f4726e)' : 'var(--border-subtle)'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                <span>{PLATFORM_ICONS[p]}</span>
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Channel name (e.g. #general, my-webhook)"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            style={{
              padding: '8px 12px',
              fontSize: 13,
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
            }}
          />
          <textarea
            placeholder={
              form.platform === 'webhook'
                ? 'Webhook URL (https://…)'
                : form.platform === 'slack'
                  ? 'Slack Bot Token or Webhook URL'
                  : 'Optional JSON config (token, webhook URL, etc.)'
            }
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
              borderRadius: 8,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!form.name.trim() || saving}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: 'var(--coral-bright, #f4726e)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: !form.name.trim() || saving ? 'not-allowed' : 'pointer',
                opacity: !form.name.trim() || saving ? 0.5 : 1,
              }}
            >
              {saving ? 'Adding…' : 'Add Channel'}
            </button>
          </div>
        </div>
      )}

      {channels.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          No channels configured. Add a channel to route claw messages to external platforms.
        </div>
      ) : (
        channels.map((ch) => (
          <div key={ch.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{PLATFORM_ICONS[ch.platform]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{ch.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {PLATFORM_LABELS[ch.platform]}
              </div>
            </div>
            {/* Enabled toggle */}
            <button
              type="button"
              onClick={() => handleToggle(ch)}
              disabled={togglingId === ch.id}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: ch.enabled ? 'rgba(0,229,204,0.15)' : 'var(--bg-elevated)',
                color: ch.enabled ? 'var(--cyan-bright, #00e5cc)' : 'var(--text-muted)',
                border: `1px solid ${ch.enabled ? 'var(--cyan-bright, #00e5cc)' : 'var(--border-subtle)'}`,
                borderRadius: 6,
                cursor: togglingId === ch.id ? 'wait' : 'pointer',
                flexShrink: 0,
              }}
            >
              {togglingId === ch.id ? '…' : ch.enabled ? 'Enabled' : 'Disabled'}
            </button>
            <button
              type="button"
              onClick={() => handleDelete(ch.id)}
              disabled={deletingId === ch.id}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: 'none',
                color: 'var(--coral-bright, #f4726e)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                cursor: deletingId === ch.id ? 'wait' : 'pointer',
                flexShrink: 0,
              }}
            >
              {deletingId === ch.id ? '…' : 'Delete'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
