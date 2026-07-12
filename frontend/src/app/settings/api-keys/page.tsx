'use client';

import { Fragment, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useConfirm } from '@/components/ConfirmProvider';
import { tenantApiKeysApi, type TenantApiKey } from '@/lib/builderforceApi';
import { getStoredTenant } from '@/lib/auth';
import { MintedTenantApiKeyDisplay } from '@/components/MintedTenantApiKeyDisplay';
import { AllowedOriginsField } from '@/components/AllowedOriginsField';
import { AllowedOriginsBadge } from '@/components/AllowedOriginsBadge';
import { TenantApiKeyEditor } from '@/components/TenantApiKeyEditor';
import { TenantApiKeyUsageDrawer } from '@/components/TenantApiKeyUsageDrawer';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { ProviderKeysSettings } from '@/components/ProviderKeysSettings';
import PageContainer from '@/components/PageContainer';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';

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

export default function ApiKeysContent({ embedded = false, showProviderKeys = true, search = '', externalViewMode }: { embedded?: boolean; showProviderKeys?: boolean; search?: string; externalViewMode?: ViewMode } = {}) {
  const t = useTranslations('apiKeys');
  const router = useRouter();
  const confirm = useConfirm();
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
  const [expandedKeyId, setExpandedKeyId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const effectiveViewMode = externalViewMode ?? viewMode;
  const visibleKeys = keys.filter((key) => !search.trim() || key.name.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    if (!isOwner || !Number.isFinite(tenantId)) { setLoading(false); return; }
    tenantApiKeysApi.list(tenantId)
      .then(setKeys)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isOwner, tenantId]);

  useEffect(() => { if (!embedded) router.replace('/settings/integrations'); }, [embedded, router]);

  if (!embedded) return null;

  if (!tenant) {
    return (
      <PageContainer width="narrow" style={{ padding: '32px 40px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>{t('title')}</h1>
        <div style={cardStyle}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('selectWorkspace')}</p>
        </div>
      </PageContainer>
    );
  }

  if (!isOwner) {
    return (
      <PageContainer width="narrow" style={{ padding: '32px 40px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>{t('title')}</h1>
        <div style={cardStyle}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t.rich('ownerOnly', { strong: (chunks) => <strong style={{ color: 'var(--text-primary)' }}>{chunks}</strong> })}
          </p>
        </div>
      </PageContainer>
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
      setError(e instanceof Error ? e.message : t('errCreate'));
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
    if (!(await confirm(t('confirmRevoke')))) return;
    setRevoking(keyId);
    setError(null);
    try {
      await tenantApiKeysApi.revoke(tenantId, keyId);
      setKeys((prev) => prev.map((k) => k.id === keyId ? { ...k, revokedAt: new Date().toISOString() } : k));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errRevoke'));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <PageContainer width={embedded ? 'full' : 'narrow'} style={{ padding: embedded ? 0 : '32px 40px' }}>
      {!embedded && <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{t('title')}</h1>}
      {!embedded && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
        {t.rich('subtitle', {
          code: (chunks) => <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{chunks}</code>,
          strong: (chunks) => <strong style={{ color: 'var(--text-primary)' }}>{chunks}</strong>,
        })}
      </p>}

      {revealedKey && (
        <div style={{ marginBottom: 20 }}>
          <MintedTenantApiKeyDisplay
            rawKey={revealedKey.key}
            name={revealedKey.name}
            onDismiss={() => setRevealedKey(null)}
          />
        </div>
      )}

      {showProviderKeys && <div style={{ marginBottom: 20 }}>
        <ProviderKeysSettings />
      </div>}

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={sectionTitle}>{t('createTitle')}</div>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('createNamePlaceholder')}
          disabled={creating}
          style={{
            width: '100%', padding: '8px 12px', fontSize: 13, marginBottom: 14,
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8,
            boxSizing: 'border-box',
          }}
        />

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
          {t('browserAccess')}
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
          {creating ? t('creating') : t('createKey')}
        </button>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ ...sectionTitle, marginBottom: 0 }}>{t('activeAndRevoked')}</div>
          {!externalViewMode && <ViewToggle value={viewMode} onChange={setViewMode} />}
        </div>
        <div style={{ marginBottom: 14 }} />
        {error && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>{t('errorPrefix', { message: error })}</div>
        )}
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
        ) : visibleKeys.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noKeys')}</div>
        ) : effectiveViewMode === 'card' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleKeys.map((k) => {
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
                            {t('revoked')}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {t('createdLastUsed', { created: fmtDate(k.createdAt), lastUsed: fmtDate(k.lastUsedAt) })}
                        {revoked && t('revokedOnSuffix', { revoked: fmtDate(k.revokedAt) })}
                      </div>
                    </div>
                    {!isEditing && (
                      <>
                        <button
                          type="button"
                          onClick={() => setExpandedKeyId(expandedKeyId === k.id ? null : k.id)}
                          style={{ ...buttonPrimary, padding: '4px 10px', fontSize: 11, background: 'none' }}
                        >
                          {expandedKeyId === k.id ? t('hideActivity') : t('viewActivity')}
                        </button>
                        {!revoked && (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditingKeyId(k.id)}
                              style={{ ...buttonPrimary, padding: '4px 10px', fontSize: 11 }}
                            >
                              {t('edit')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRevoke(k.id)}
                              disabled={revoking === k.id}
                              style={buttonDanger}
                            >
                              {revoking === k.id ? '…' : t('revoke')}
                            </button>
                          </>
                        )}
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
                  <TenantApiKeyUsageDrawer
                    expanded={expandedKeyId === k.id}
                    load={(params) => tenantApiKeysApi.usage(tenantId, k.id, params)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('colName')}</th>
                  <th style={thStyle}>{t('colStatus')}</th>
                  <th style={thStyle}>{t('colCreated')}</th>
                  <th style={thStyle}>{t('colLastUsed')}</th>
                  <th style={thStyle}>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleKeys.map((k) => {
                  const revoked = !!k.revokedAt;
                  const isEditing = editingKeyId === k.id;
                  return (
                    <Fragment key={k.id}>
                      <tr style={{ ...trStyle, opacity: revoked ? 0.5 : 1 }}>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
                            <span
                              style={{
                                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                display: 'inline-block',
                                background: revoked ? 'var(--text-muted)' : 'rgba(34,197,94,0.9)',
                              }}
                            />
                            <span>{k.name}</span>
                            <AllowedOriginsBadge allowedOrigins={k.allowedOrigins} />
                          </div>
                        </td>
                        <td style={tdMutedStyle}>
                          {revoked ? t('revokedOn', { revoked: fmtDate(k.revokedAt) }) : t('active')}
                        </td>
                        <td style={tdMutedStyle}>{fmtDate(k.createdAt)}</td>
                        <td style={tdMutedStyle}>{fmtDate(k.lastUsedAt)}</td>
                        <td style={tdStyle}>
                          {!isEditing && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                onClick={() => setExpandedKeyId(expandedKeyId === k.id ? null : k.id)}
                                style={{ ...buttonPrimary, padding: '4px 10px', fontSize: 11, background: 'none' }}
                              >
                                {expandedKeyId === k.id ? t('hideActivity') : t('viewActivity')}
                              </button>
                              {!revoked && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setEditingKeyId(k.id)}
                                    style={{ ...buttonPrimary, padding: '4px 10px', fontSize: 11 }}
                                  >
                                    {t('edit')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRevoke(k.id)}
                                    disabled={revoking === k.id}
                                    style={buttonDanger}
                                  >
                                    {revoking === k.id ? '…' : t('revoke')}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                      {(isEditing || expandedKeyId === k.id) && (
                        <tr style={trStyle}>
                          <td style={tdStyle} colSpan={5}>
                            {isEditing && (
                              <TenantApiKeyEditor
                                initialName={k.name}
                                initialAllowedOrigins={k.allowedOrigins}
                                onSave={(patch) => handleEdit(k.id, patch)}
                                onCancel={() => setEditingKeyId(null)}
                                saving={savingEdit}
                              />
                            )}
                            <TenantApiKeyUsageDrawer
                              expanded={expandedKeyId === k.id}
                              load={(params) => tenantApiKeysApi.usage(tenantId, k.id, params)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
