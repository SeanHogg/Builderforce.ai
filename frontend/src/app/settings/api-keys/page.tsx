'use client';

import { useEffect, useState } from 'react';
import { tenantApiKeysApi, type TenantApiKey } from '@/lib/builderforceApi';
import { getStoredTenant } from '@/lib/auth';
import { MintedTenantApiKeyDisplay } from '@/components/MintedTenantApiKeyDisplay';
import { AllowedOriginsField } from '@/components/AllowedOriginsField';
import { AllowedOriginsBadge } from '@/components/AllowedOriginsBadge';
import { TenantApiKeyEditor } from '@/components/TenantApiKeyEditor';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: 14,
};

const buttonPrimary: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  background: 'var(--surface-interactive)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  cursor: 'pointer',
};

const buttonDanger: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 600,
  background: 'none',
  color: 'var(--coral-bright, #f4726e)',
  border: '1px solid var(--coral-bright, #f4726e)',
  borderRadius: 6,
  cursor: 'pointer',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function ApiKeysPage() {
  const tenant = getStoredTenant();
  const tenantId = tenant ? Number(tenant.id) : NaN;
  const isOwner = tenant?.role === 'owner';

  const [keys, setKeys] = useState<TenantApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAllowedOrigins, setNewAllowedOrigins] = useState<string[] | null>(null);
  const [revealedKey, setRevealedKey] = useState<{ id: string; key: string; name: string } | null>(null);

  const [revoking, setRevoking] = useState<string | null>(null);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!isOwner || !Number.isFinite(tenantId)) { setLoading(false); return; }
    tenantApiKeysApi.list(tenantId)
      .then(setKeys)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isOwner, tenantId]);

  if (!tenant) {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>API Keys</h1>
        <div style={cardStyle}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Select a workspace to manage API keys.</p>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>API Keys</h1>
        <div style={cardStyle}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Only the workspace <strong style={{ color: 'var(--text-primary)' }}>owner</strong> can mint or revoke
            tenant API keys (these credentials can spend the workspace&apos;s daily token budget).
          </p>
        </div>
      </div>
    );
  }

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const result = await tenantApiKeysApi.mint(tenantId, { name, allowedOrigins: newAllowedOrigins });
      setRevealedKey({ id: result.id, key: result.key, name: result.name });
      setKeys((prev) => [
        { id: result.id, name: result.name, createdByUserId: null, allowedOrigins: result.allowedOrigins, lastUsedAt: null, revokedAt: null, createdAt: result.createdAt },
        ...prev,
      ]);
      setNewName('');
      setNewAllowedOrigins(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async (keyId: string, patch: { name?: string; allowedOrigins?: string[] | null }) => {
    setSavingEdit(true);
    try {
      const updated = await tenantApiKeysApi.update(tenantId, keyId, patch);
      setKeys((prev) => prev.map((k) => k.id === keyId ? updated : k));
      setEditingKeyId(null);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm('Revoke this API key? Apps using it will stop working immediately.')) return;
    setRevoking(keyId);
    setError(null);
    try {
      await tenantApiKeysApi.revoke(tenantId, keyId);
      setKeys((prev) => prev.map((k) => k.id === keyId ? { ...k, revokedAt: new Date().toISOString() } : k));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div style={{ padding: '32px 40px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>API Keys</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
        Tenant-scoped <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>bfk_*</code> keys for the{' '}
        <strong style={{ color: 'var(--text-primary)' }}>builderforceLLM</strong> gateway. Use them in tenant apps
        (server-side) to call <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>/llm/v1/chat/completions</code>.
        Plan-level daily token caps still apply.
      </p>

      {revealedKey && (
        <div style={{ marginBottom: 20 }}>
          <MintedTenantApiKeyDisplay
            rawKey={revealedKey.key}
            name={revealedKey.name}
            onDismiss={() => setRevealedKey(null)}
          />
        </div>
      )}

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={sectionTitle}>Create a new key</div>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. hired.video production"
          disabled={creating}
          style={{
            width: '100%', padding: '8px 12px', fontSize: 13, marginBottom: 14,
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8,
            boxSizing: 'border-box',
          }}
        />

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
          Browser access
        </div>
        <AllowedOriginsField
          value={newAllowedOrigins}
          onChange={setNewAllowedOrigins}
          disabled={creating}
        />

        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={creating || !newName.trim()}
          style={{ ...buttonPrimary, opacity: creating || !newName.trim() ? 0.5 : 1, marginTop: 8 }}
        >
          {creating ? 'Creating…' : 'Create key'}
        </button>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>Active and revoked keys</div>
        {error && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>Error: {error}</div>
        )}
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : keys.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No keys yet. Create one above.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {keys.map((k) => {
              const revoked = !!k.revokedAt;
              const isEditing = editingKeyId === k.id;
              return (
                <div
                  key={k.id}
                  style={{
                    padding: '10px 12px', borderRadius: 8,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    opacity: revoked ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: revoked ? 'var(--text-muted)' : 'rgba(34,197,94,0.9)',
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span>{k.name}</span>
                        <AllowedOriginsBadge allowedOrigins={k.allowedOrigins} />
                        {revoked && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                            Revoked
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Created {fmtDate(k.createdAt)} · Last used {fmtDate(k.lastUsedAt)}
                        {revoked && ` · Revoked ${fmtDate(k.revokedAt)}`}
                      </div>
                    </div>
                    {!revoked && !isEditing && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingKeyId(k.id)}
                          style={{ ...buttonPrimary, padding: '4px 10px', fontSize: 11 }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRevoke(k.id)}
                          disabled={revoking === k.id}
                          style={buttonDanger}
                        >
                          {revoking === k.id ? '…' : 'Revoke'}
                        </button>
                      </>
                    )}
                  </div>
                  {isEditing && (
                    <TenantApiKeyEditor
                      initialName={k.name}
                      initialAllowedOrigins={k.allowedOrigins}
                      onSave={(patch) => handleEdit(k.id, patch)}
                      onCancel={() => setEditingKeyId(null)}
                      saving={savingEdit}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
