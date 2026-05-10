'use client';

import { useEffect, useState } from 'react';
import {
  adminApi,
  type AdminTenant,
  type AdminTenantApiKey,
  type AdminMintedTenantApiKey,
} from '@/lib/adminApi';
import { MintedTenantApiKeyDisplay } from '@/components/MintedTenantApiKeyDisplay';
import { AllowedOriginsField } from '@/components/AllowedOriginsField';
import { AllowedOriginsBadge } from '@/components/AllowedOriginsBadge';
import { TenantApiKeyEditor } from '@/components/TenantApiKeyEditor';

/**
 * Superadmin tab for minting / listing / revoking tenant `bfk_*` keys
 * on behalf of any tenant. Renders nothing unless its parent tab is active —
 * so the parent doesn't pass a `canShow` prop, the component decides.
 */
export function TenantApiKeysAdminTab({ active }: { active: boolean }) {
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [keys, setKeys] = useState<AdminTenantApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newAllowedOrigins, setNewAllowedOrigins] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<AdminMintedTenantApiKey | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Load tenant list when the tab becomes active.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    adminApi.tenants()
      .then((rows) => {
        if (cancelled) return;
        const list = rows ?? [];
        setTenants(list);
        if (tenantId == null && list.length > 0) setTenantId(list[0].id);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Load keys for the selected tenant.
  useEffect(() => {
    if (!active || tenantId == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi.listTenantApiKeys(tenantId)
      .then((rows) => !cancelled && setKeys(rows ?? []))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [active, tenantId]);

  if (!active) return null;

  const handleMint = async () => {
    if (tenantId == null) return;
    const name = newName.trim() || 'Admin-issued tenant API key';
    setCreating(true);
    setError(null);
    try {
      const minted = await adminApi.mintTenantApiKey(tenantId, { name, allowedOrigins: newAllowedOrigins });
      setRevealedKey(minted);
      setKeys((prev) => [
        { id: minted.id, name: minted.name, createdByUserId: null, allowedOrigins: minted.allowedOrigins, lastUsedAt: null, revokedAt: null, createdAt: minted.createdAt },
        ...prev,
      ]);
      setNewName('');
      setNewAllowedOrigins(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mint failed');
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async (keyId: string, patch: { name?: string; allowedOrigins?: string[] | null }) => {
    if (tenantId == null) return;
    setSavingEdit(true);
    setError(null);
    try {
      const updated = await adminApi.updateTenantApiKey(tenantId, keyId, patch);
      setKeys((prev) => prev.map((k) => k.id === keyId ? updated : k));
      setEditingKeyId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (tenantId == null) return;
    if (!confirm('Revoke this API key? Apps using it will stop working immediately.')) return;
    setRevoking(keyId);
    setError(null);
    try {
      await adminApi.revokeTenantApiKey(tenantId, keyId);
      setKeys((prev) => prev.map((k) => k.id === keyId ? { ...k, revokedAt: new Date().toISOString() } : k));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  };

  const fmtDate = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString() : '—';

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label htmlFor="apikeys-tenant" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Tenant:</label>
        <select
          id="apikeys-tenant"
          value={tenantId ?? ''}
          onChange={(e) => setTenantId(Number(e.target.value))}
          style={{
            padding: '6px 10px', fontSize: 13,
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8,
          }}
        >
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
          ))}
        </select>
        {tenantId != null && (
          <button type="button" className="btn-ghost" onClick={() => setTenantId(tenantId)}>
            ↻ Refresh
          </button>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 12 }}>Error: {error}</div>
      )}

      {revealedKey && (
        <div style={{ marginBottom: 16 }}>
          <MintedTenantApiKeyDisplay
            rawKey={revealedKey.key}
            name={revealedKey.name}
            onDismiss={() => setRevealedKey(null)}
          />
        </div>
      )}

      <div style={{
        padding: 16, marginBottom: 16,
        background: 'var(--bg-base)', borderRadius: 12,
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Mint a new bfk_* key</div>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. hired.video production"
          disabled={creating || tenantId == null}
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
          disabled={creating || tenantId == null}
        />

        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleMint()}
          disabled={creating || tenantId == null}
          style={{ marginTop: 8 }}
        >
          {creating ? 'Minting…' : 'Mint'}
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Browser</th>
              <th>Created by</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : keys.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No keys for this tenant.</td></tr>
            ) : keys.flatMap((k) => {
              const revoked = !!k.revokedAt;
              const isEditing = editingKeyId === k.id;
              const rows = [
                <tr key={k.id} style={{ opacity: revoked ? 0.5 : 1 }}>
                  <td>{k.name}</td>
                  <td><AllowedOriginsBadge allowedOrigins={k.allowedOrigins} /></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{k.createdByUserId ?? '—'}</td>
                  <td>{fmtDate(k.createdAt)}</td>
                  <td>{fmtDate(k.lastUsedAt)}</td>
                  <td>{revoked ? `Revoked ${fmtDate(k.revokedAt)}` : 'Active'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    {!revoked && !isEditing && (
                      <>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => setEditingKeyId(k.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => void handleRevoke(k.id)}
                          disabled={revoking === k.id}
                        >
                          {revoking === k.id ? '…' : 'Revoke'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>,
              ];
              if (isEditing) {
                rows.push(
                  <tr key={`${k.id}-edit`}>
                    <td colSpan={7} style={{ background: 'var(--bg-base)' }}>
                      <TenantApiKeyEditor
                        initialName={k.name}
                        initialAllowedOrigins={k.allowedOrigins}
                        onSave={(patch) => handleEdit(k.id, patch)}
                        onCancel={() => setEditingKeyId(null)}
                        saving={savingEdit}
                      />
                    </td>
                  </tr>,
                );
              }
              return rows;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
