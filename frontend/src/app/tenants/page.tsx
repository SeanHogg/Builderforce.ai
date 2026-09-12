'use client';

import { Icon } from '@/components/ui/Icon';
import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { hasSession, useRequireSession } from '@/lib/useRequireSession';
import { getDefaultTenantId, setDefaultTenantId, clearDefaultTenantId } from '@/lib/auth';
import { workspacesApi } from '@/lib/auth/session';
import type { Tenant } from '@/lib/types';
import { useErrorMessage } from '@/i18n/useErrorMessage';

/** Auto-select tenant when there is only one or a default is set (BuilderForceAgentsLink-style). Returns the tenant to select or null. */
function resolveAutoSelectTenant(list: Tenant[]): Tenant | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const defaultId = getDefaultTenantId();
  if (!defaultId) return null;
  const match = list.find((t) => String(t.id) === defaultId);
  return match ?? null;
}

// Theme tokens only — this page renders in whichever theme the person signed in
// from, and the Tailwind gray scale it used to be written in is remapped per theme.
const s = {
  page: { minHeight: '100vh', background: 'var(--bg-deep)', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column' },
  main: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 16px' },
  column: { width: '100%', maxWidth: '28rem' },
  title: { fontSize: 'var(--font-size-page-title)', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' },
  subtitle: { fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', margin: '0 0 32px' },
  error: { background: 'var(--bg-elevated)', border: '1px solid var(--error-text)', color: 'var(--error-text)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 24, fontSize: 'var(--font-size-small)' },
  skeleton: { background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', height: 64 },
  card: { width: '100%', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16 },
  panel: { background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16, display: 'grid', gap: 16 },
  input: { flex: 1, minWidth: 0, width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' },
  primary: { padding: '8px 16px', minHeight: 40, borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--coral-bright)', color: 'var(--text-on-accent)', fontWeight: 600, fontSize: 'var(--font-size-small)', cursor: 'pointer', flexShrink: 0 },
  secondary: { padding: '8px 16px', minHeight: 40, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)', cursor: 'pointer', flexShrink: 0 },
  chip: { padding: '4px 8px', minHeight: 32, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer' },
  link: { background: 'none', border: 'none', padding: 0, color: 'var(--coral-bright)', cursor: 'pointer', fontSize: 'var(--font-size-eyebrow)' },
  avatar: { width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--coral-bright)', fontWeight: 700, fontSize: 'var(--font-size-card-title)', flexShrink: 0 },
  badge: { display: 'inline-flex', alignItems: 'center', padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--coral-bright)', border: '1px solid var(--border-subtle)' },
  muted: { color: 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)' },
  dashed: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)', cursor: 'pointer' },
} satisfies Record<string, CSSProperties>;

export default function TenantsPage() {
  const t = useTranslations('workspacePicker');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasTenant, fetchTenants, selectTenant } = useAuth();
  const errorMessage = useErrorMessage();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSelecting, setIsSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const autoSelectAttempted = useRef(false);

  // The workspace picker is the one authed page that must NOT require a tenant —
  // choosing one is what it is for.
  const session = useRequireSession({ requireTenant: false });
  const signedIn = hasSession(session);

  // Load tenants
  useEffect(() => {
    if (!signedIn) return;
    fetchTenants()
      .then((data) => {
        if (!Array.isArray(data)) {
          const arr = (data as { tenants?: Tenant[] })?.tenants;
          setTenants(Array.isArray(arr) ? arr : []);
          return;
        }
        setTenants(data);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setIsLoading(false));
  }, [signedIn, fetchTenants, errorMessage]);

  // Auto-select tenant only when user has no tenant (e.g. just from login). If they already have a tenant, they're visiting to switch or create one — don't redirect.
  useEffect(() => {
    if (!signedIn || hasTenant || isLoading || tenants.length === 0 || autoSelectAttempted.current) return;
    const target = resolveAutoSelectTenant(tenants);
    if (!target) return;
    autoSelectAttempted.current = true;
    selectTenant(target)
      .then(() => {
        const next = searchParams.get('next') || '/dashboard';
        router.replace(next);
      })
      .catch(() => {
        autoSelectAttempted.current = false;
      });
  }, [signedIn, hasTenant, isLoading, tenants, searchParams, router, selectTenant]);

  const handleSelect = async (tenant: Tenant) => {
    setIsSelecting(tenant.id);
    setError(null);
    try {
      await selectTenant(tenant);
      const next = searchParams.get('next') || '/dashboard';
      router.push(next);
    } catch (err) {
      setError(errorMessage(err));
      setIsSelecting(null);
    }
  };

  const [defaultTenantId, setDefaultTenantIdState] = useState<string | null>(() => getDefaultTenantId());
  const handleSetDefault = (e: React.MouseEvent, tenant: Tenant) => {
    e.preventDefault();
    e.stopPropagation();
    const id = String(tenant.id);
    setDefaultTenantId(id);
    setDefaultTenantIdState(id);
  };
  const handleClearDefault = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearDefaultTenantId();
    setDefaultTenantIdState(null);
  };
  // Sync default from storage on mount / when tenants change (e.g. after navigation)
  useEffect(() => {
    setDefaultTenantIdState(getDefaultTenantId());
  }, [tenants.length]);

  // Prevent default-action clicks from triggering the parent select button
  const preventSelectBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signedIn || !createName.trim()) return;
    setError(null);
    setIsCreating(true);
    try {
      const newTenant = await workspacesApi.create(createName);
      const hadNoTenants = tenants.length === 0;
      setTenants((prev) => [...prev, newTenant]);
      setCreateName('');
      setShowCreate(false);
      // If user had no tenants, auto-select the new one and redirect to dashboard
      if (hadNoTenants) {
        await selectTenant(newTenant);
        const next = searchParams.get('next') || '/dashboard';
        router.replace(next);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsCreating(false);
    }
  };

  const startRename = (e: React.MouseEvent, tenant: Tenant) => {
    e.preventDefault();
    e.stopPropagation();
    setRenamingId(tenant.id);
    setRenameName(tenant.name || '');
    setError(null);
  };
  const cancelRename = () => {
    setRenamingId(null);
    setRenameName('');
  };
  const handleRename = async (e: React.FormEvent, tenant: Tenant) => {
    e.preventDefault();
    const trimmed = renameName.trim();
    if (!signedIn || !trimmed || trimmed === tenant.name) {
      cancelRename();
      return;
    }
    setError(null);
    setIsRenaming(true);
    try {
      const updated = await workspacesApi.rename(tenant.id, trimmed);
      setTenants((prev) => prev.map((x) => (x.id === tenant.id ? { ...x, name: updated.name, slug: updated.slug ?? x.slug } : x)));
      cancelRename();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsRenaming(false);
    }
  };
  // A workspace can be renamed by its owners and managers. When role is unknown
  // (older token shapes), allow the attempt — the API enforces authorization.
  const canRename = (x: Tenant) => !x.role || x.role === 'owner' || x.role === 'manager';

  if (session === 'loading') return null;

  return (
    <div style={s.page}>
      <main style={s.main}>
        <div style={s.column}>
          <h1 style={s.title}>{t('title')}</h1>
          <p style={s.subtitle}>{t('subtitle')}</p>

          {error && <div role="alert" style={s.error}>{error}</div>}

          {isLoading ? (
            <div style={{ display: 'grid', gap: 12 }} aria-busy="true" aria-label={tc('loading')}>
              {[0, 1].map((i) => <div key={i} style={s.skeleton} className="animate-pulse" />)}
            </div>
          ) : tenants.length === 0 && !showCreate ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ marginBottom: 16 }}><Icon source="🏢" size={36} /></div>
              <p style={{ color: 'var(--text-secondary)', margin: '0 0 8px' }}>{t('emptyTitle')}</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', margin: '0 0 24px' }}>{t('emptyBody')}</p>
              <button type="button" onClick={() => setShowCreate(true)} style={s.primary}>{t('createWorkspace')}</button>
            </div>
          ) : showCreate ? (
            <div style={{ display: 'grid', gap: 16 }}>
              <form onSubmit={handleCreateTenant} style={s.panel}>
                <h2 style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 600, margin: 0 }}>{t('createHeading')}</h2>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  aria-label={t('namePlaceholder')}
                  style={s.input}
                  autoFocus
                  disabled={isCreating}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="submit" disabled={isCreating || !createName.trim()} style={{ ...s.primary, opacity: isCreating || !createName.trim() ? 0.5 : 1 }}>
                    {isCreating ? t('creating') : t('create')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreate(false); setCreateName(''); setError(null); }}
                    disabled={isCreating}
                    style={s.secondary}
                  >
                    {tc('cancel')}
                  </button>
                </div>
              </form>
              {tenants.length > 0 && (
                <button type="button" onClick={() => setShowCreate(false)} style={{ ...s.link, color: 'var(--text-muted)', justifySelf: 'start' }}>
                  {t('backToList')}
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {defaultTenantId && (
                <div style={{ ...s.muted, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span>{t('defaultHint')}</span>
                  <button type="button" onClick={handleClearDefault} style={s.link}>{t('clearDefault')}</button>
                </div>
              )}
              {tenants.map((x) => {
                const isDefault = String(x.id) === defaultTenantId;
                const isEditing = renamingId === x.id;
                return (
                  <div key={x.id} style={s.card}>
                    {isEditing ? (
                      <form onSubmit={(e) => handleRename(e, x)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          value={renameName}
                          onChange={(e) => setRenameName(e.target.value)}
                          placeholder={t('namePlaceholder')}
                          aria-label={t('namePlaceholder')}
                          style={s.input}
                          autoFocus
                          disabled={isRenaming}
                          onKeyDown={(e) => { if (e.key === 'Escape') cancelRename(); }}
                        />
                        <button type="submit" disabled={isRenaming || !renameName.trim()} style={{ ...s.primary, opacity: isRenaming || !renameName.trim() ? 0.5 : 1 }}>
                          {isRenaming ? tc('saving') : tc('save')}
                        </button>
                        <button type="button" onClick={cancelRename} disabled={isRenaming} style={s.secondary}>
                          {tc('cancel')}
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSelect(x)}
                          disabled={!!isSelecting}
                          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, background: 'none', border: 'none', padding: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer', opacity: isSelecting ? 0.5 : 1 }}
                        >
                          <div style={s.avatar}>{(x.name || x.id).charAt(0).toUpperCase()}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {x.name || x.id}
                              {isDefault && <span style={s.badge}>{t('defaultBadge')}</span>}
                            </div>
                            {x.slug && <div style={{ ...s.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.slug}</div>}
                          </div>
                          {isSelecting === x.id ? (
                            <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{tc('loading')}</div>
                          ) : (
                            <svg aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--text-muted)', flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </button>
                        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }} onClick={preventSelectBubble} onMouseDown={preventSelectBubble}>
                          {canRename(x) && (
                            <button type="button" onClick={(e) => startRename(e, x)} style={s.chip} title={t('renameTitle')}>
                              {t('rename')}
                            </button>
                          )}
                          {isDefault ? (
                            <button type="button" onClick={handleClearDefault} style={s.chip} title={t('clearDefaultTitle')}>
                              {t('clearDefault')}
                            </button>
                          ) : (
                            <button type="button" onClick={(e) => handleSetDefault(e, x)} style={s.chip} title={t('setDefaultTitle')}>
                              {t('setDefault')}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              <div style={{ paddingTop: 8 }}>
                <button type="button" onClick={() => { setShowCreate(true); setError(null); }} style={s.dashed}>
                  <span aria-hidden="true" style={{ fontSize: 'var(--font-size-card-title)' }}>+</span> {t('newWorkspace')}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
