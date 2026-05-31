'use client';

import { useEffect, useState } from 'react';
import { EMBED_CAPABILITIES, type EmbedCapability } from '@seanhogg/builderforce-embedded';
import { embedApi } from '@/lib/builderforceApi';
import { getStoredTenant } from '@/lib/auth';

/**
 * SuperAdmin enablement for the embedded integration: turn on embedding and pick
 * which capability areas (Product / Agile / Security) host apps may surface.
 * Self-gating — renders nothing unless the caller is an owner/manager, so the
 * settings page needs no canX prop (writes are also role-gated server-side).
 */

const CAPABILITY_LABELS: Record<EmbedCapability, string> = {
  product: 'Product',
  agile: 'Agile',
  security: 'Security',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 20,
};

export function EmbedIntegrationSettings() {
  const role = getStoredTenant()?.role;
  const canManage = role === 'owner' || role === 'manager';

  const [enabled, setEnabled] = useState(false);
  const [capabilities, setCapabilities] = useState<EmbedCapability[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    embedApi
      .getConfig()
      .then((cfg) => {
        if (cancelled) return;
        setEnabled(cfg.enabled);
        setCapabilities(cfg.capabilities);
      })
      .catch(() => !cancelled && setError('Could not load integration settings.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  if (!canManage) return null;

  const toggleCapability = (cap: EmbedCapability) => {
    setSaved(false);
    setCapabilities((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await embedApi.setConfig({ enabled, capabilities });
      setSaved(true);
    } catch {
      setError('Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
        Embedded Integration
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Surface BuilderForce Product, Agile, and Security capabilities as embedded widgets inside your host application.
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loading…</div>
      ) : (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setSaved(false);
                setEnabled(e.target.checked);
              }}
            />
            <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Enable embedded integration</span>
          </label>

          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Capabilities</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, opacity: enabled ? 1 : 0.5 }}>
            {EMBED_CAPABILITIES.map((cap) => (
              <label key={cap} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: enabled ? 'pointer' : 'default' }}>
                <input
                  type="checkbox"
                  disabled={!enabled}
                  checked={capabilities.includes(cap)}
                  onChange={() => toggleCapability(cap)}
                />
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{CAPABILITY_LABELS[cap]}</span>
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                background: 'var(--accent, #2563eb)', color: '#fff',
                border: 'none', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span style={{ fontSize: 12, color: '#16a34a' }}>Saved ✓</span>}
            {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
