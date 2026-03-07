'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import type { Tenant } from '@/lib/types';

export default function TenantsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, fetchTenants, selectTenant, logout, user } = useAuth();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSelecting, setIsSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          console.warn('fetchTenants did not return array', data);
          // try to recover from { tenants: [...] } shape
          const arr = (data as any)?.tenants;
          if (Array.isArray(arr)) {
            setTenants(arr);
            return;
          }
          setTenants([]);
        } else {
          setTenants(data);
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load tenants')
      )
      .finally(() => setIsLoading(false));
  }, [isAuthenticated, fetchTenants]);

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

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 text-2xl">⚡</span>
            <span className="text-xl font-bold text-white">Builderforce.ai</span>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="text-sm text-gray-400">{user.email}</span>
            )}
            <button
              onClick={() => { logout(); router.push('/login'); }}
              className="text-sm text-gray-500 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
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
          ) : tenants.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-4xl mb-4">🏢</div>
              <p className="text-gray-400 mb-2">No workspaces found.</p>
              <p className="text-gray-500 text-sm">
                Contact your administrator to be added to an organization, or create one on{' '}
                <a
                  href="https://api.coderclaw.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors"
                >
                  api.coderclaw.ai
                </a>
                .
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tenants.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelect(t)}
                  disabled={!!isSelecting}
                  className="w-full flex items-center gap-4 bg-gray-900 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-xl p-4 transition-all text-left disabled:opacity-50"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-600/40 flex items-center justify-center text-blue-400 font-bold text-lg flex-shrink-0">
                    {(t.name || t.id).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white truncate">{t.name || t.id}</div>
                    {t.slug && (
                      <div className="text-xs text-gray-500 truncate">{t.slug}</div>
                    )}
                  </div>
                  {isSelecting === t.id ? (
                    <div className="text-gray-400 text-sm">Loading…</div>
                  ) : (
                    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
