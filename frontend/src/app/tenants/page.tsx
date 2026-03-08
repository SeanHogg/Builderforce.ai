'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getDefaultTenantId, setDefaultTenantId, clearDefaultTenantId, createTenant as apiCreateTenant } from '@/lib/auth';
import type { Tenant } from '@/lib/types';

/** Auto-select tenant when there is only one or a default is set (CoderClawLink-style). Returns the tenant to select or null. */
function resolveAutoSelectTenant(list: Tenant[]): Tenant | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const defaultId = getDefaultTenantId();
  if (!defaultId) return null;
  const match = list.find((t) => String(t.id) === defaultId);
  return match ?? null;
}

export default function TenantsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant, webToken, fetchTenants, selectTenant } = useAuth();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSelecting, setIsSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const autoSelectAttempted = useRef(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, router]);

  // Load tenants
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchTenants()
      .then((data) => {
        if (!Array.isArray(data)) {
          const arr = (data as { tenants?: Tenant[] })?.tenants;
          if (Array.isArray(arr)) {
            setTenants(arr);
            return;
          }
          setTenants([]);
          return;
        }
        setTenants(data);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load tenants')
      )
      .finally(() => setIsLoading(false));
  }, [isAuthenticated, fetchTenants]);

  // Auto-select tenant only when user has no tenant (e.g. just from login). If they already have a tenant, they're visiting to switch or create one — don't redirect.
  useEffect(() => {
    if (!isAuthenticated || hasTenant || isLoading || tenants.length === 0 || autoSelectAttempted.current) return;
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
  }, [isAuthenticated, hasTenant, isLoading, tenants, searchParams, router, selectTenant]);

  const handleSelect = async (tenant: Tenant) => {
    setIsSelecting(tenant.id);
    setError(null);
    try {
      await selectTenant(tenant);
      const next = searchParams.get('next') || '/dashboard';
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select tenant');
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

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webToken || !createName.trim()) return;
    setError(null);
    setIsCreating(true);
    try {
      const newTenant = await apiCreateTenant(webToken, createName);
      setTenants((prev) => [...prev, newTenant]);
      setCreateName('');
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setIsCreating(false);
    }
  };

  if (!isAuthenticated) return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column' }}>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-white mb-2">Select workspace</h1>
          <p className="text-gray-400 text-sm mb-8">
            Choose the organization you want to work in.
          </p>

          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 mb-6 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="bg-gray-800 rounded-xl p-4 h-16 animate-pulse" />
              ))}
            </div>
          ) : tenants.length === 0 && !showCreate ? (
            <div className="text-center py-10">
              <div className="text-4xl mb-4">🏢</div>
              <p className="text-gray-400 mb-2">No workspaces yet.</p>
              <p className="text-gray-500 text-sm mb-6">
                Create a workspace to get started.
              </p>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-colors"
              >
                Create workspace
              </button>
            </div>
          ) : showCreate ? (
            <div className="space-y-4">
              <form onSubmit={handleCreateTenant} className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-4">
                <h2 className="text-lg font-semibold text-white">Create new Tenant</h2>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Workspace name"
                  className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  autoFocus
                  disabled={isCreating}
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isCreating || !createName.trim()}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-sm"
                  >
                    {isCreating ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreate(false); setCreateName(''); setError(null); }}
                    disabled={isCreating}
                    className="px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-500 text-gray-300 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
              {tenants.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="text-sm text-gray-500 hover:text-gray-400"
                >
                  ← Back to workspaces
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {defaultTenantId && (
                <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                  <span>Default workspace is selected automatically on next visit.</span>
                  <button
                    type="button"
                    onClick={handleClearDefault}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Clear default
                  </button>
                </div>
              )}
              {tenants.map((t) => {
                const isDefault = String(t.id) === defaultTenantId;
                return (
                  <div
                    key={t.id}
                    className="w-full flex items-center gap-4 bg-gray-900 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-xl p-4 transition-all text-left group"
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(t)}
                      disabled={!!isSelecting}
                      className="flex-1 flex items-center gap-4 min-w-0 disabled:opacity-50"
                    >
                      <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-600/40 flex items-center justify-center text-blue-400 font-bold text-lg flex-shrink-0">
                        {(t.name || t.id).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-white truncate flex items-center gap-2">
                          {t.name || t.id}
                          {isDefault && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-600/30 text-blue-300 border border-blue-500/40">
                              Default
                            </span>
                          )}
                        </div>
                        {t.slug && (
                          <div className="text-xs text-gray-500 truncate">{t.slug}</div>
                        )}
                      </div>
                      {isSelecting === t.id ? (
                        <div className="text-gray-400 text-sm">Loading…</div>
                      ) : (
                        <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </button>
                    {isDefault ? (
                      <button
                        type="button"
                        onClick={handleClearDefault}
                        className="flex-shrink-0 px-2 py-1 text-xs text-gray-500 hover:text-gray-300 border border-gray-600 hover:border-gray-500 rounded transition-opacity"
                        title="Clear default tenant"
                      >
                        Clear default
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => handleSetDefault(e, t)}
                        className="flex-shrink-0 px-2 py-1 text-xs text-gray-500 hover:text-gray-300 border border-gray-600 hover:border-gray-500 rounded transition-opacity"
                        title="Set as default tenant"
                      >
                        Set default
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(true); setError(null); }}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-gray-600 hover:border-gray-500 text-gray-400 hover:text-gray-300 text-sm transition-colors"
                >
                  <span className="text-lg">+</span> Create new Tenant
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
