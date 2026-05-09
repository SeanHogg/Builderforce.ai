'use client';

import { useEffect, useState } from 'react';
import {
  adminApi,
  type AdminTenant,
  type AdminTenantApiKey,
  type AdminMintedTenantApiKey,
} from '@/lib/adminApi';

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
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<AdminMintedTenantApiKey | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

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
      const minted = await adminApi.mintTenantApiKey(tenantId, name);
      setRevealedKey(minted);
      setKeys((prev) => [
        { id: minted.id, name: minted.name, createdByUserId: null, lastUsedAt: null, revokedAt: null, createdAt: minted.createdAt },
        ...prev,
      ]);
      setNewName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mint failed');
    } finally {
      setCreating(false);
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
        <div style={{
          padding: 16, marginBottom: 16,
          background: 'var(--bg-base)', borderRadius: 12,
          border: '1px solid var(--coral-bright, #f4726e)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            Save this key now — it will not be shown again
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{revealedKey.name}</div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 13, padding: '10px 12px',
            background: 'var(--bg-elevated)', borderRadius: 8, wordBreak: 'break-all',
            border: '1px solid var(--border-subtle)',
          }}>
            {revealedKey.key}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="btn-primary" onClick={() => void navigator.clipboard.writeText(revealedKey.key)}>
              Copy
            </button>
            <button type="button" className="btn-ghost" onClick={() => setRevealedKey(null)}>
              Saved it
            </button>
          </div>
        </div>
      )}

      <div style={{
        padding: 16, marginBottom: 16,
        background: 'var(--bg-base)', borderRadius: 12,
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Mint a new bfk_* key</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. hired.video production"
            disabled={creating || tenantId == null}
            style={{
              flex: 1, padding: '8px 12px', fontSize: 13,
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 8,
            }}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleMint()}
            disabled={creating || tenantId == null}
          >
            {creating ? 'Minting…' : 'Mint'}
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Created by</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : keys.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No keys for this tenant.</td></tr>
            ) : keys.map((k) => {
              const revoked = !!k.revokedAt;
              return (
                <tr key={k.id} style={{ opacity: revoked ? 0.5 : 1 }}>
                  <td>{k.name}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{k.createdByUserId ?? '—'}</td>
                  <td>{fmtDate(k.createdAt)}</td>
                  <td>{fmtDate(k.lastUsedAt)}</td>
                  <td>{revoked ? `Revoked ${fmtDate(k.revokedAt)}` : 'Active'}</td>
                  <td>
                    {!revoked && (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => void handleRevoke(k.id)}
                        disabled={revoking === k.id}
                      >
                        {revoking === k.id ? '…' : 'Revoke'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
