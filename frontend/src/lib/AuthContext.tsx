'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { AuthUser, Tenant } from './types';
import {
  clearSession,
  getStoredTenant,
  getStoredTenantToken,
  getStoredUser,
  getStoredWebToken,
  getTenantToken,
  getMyTenants,
  login as apiLogin,
  persistSession,
  persistTenantSession,
  register as apiRegister,
} from './auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthContextValue {
  user: AuthUser | null;
  tenant: Tenant | null;
  webToken: string | null;
  tenantToken: string | null;
  isAuthenticated: boolean;
  hasTenant: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  selectTenant: (tenant: Tenant) => Promise<void>;
  fetchTenants: () => Promise<Tenant[]>;
  logout: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [webToken, setWebToken] = useState<string | null>(null);
  const [tenantToken, setTenantToken] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Rehydrate from localStorage on mount
  useEffect(() => {
    setWebToken(getStoredWebToken());
    setTenantToken(getStoredTenantToken());
    setUser(getStoredUser());
    setTenant(getStoredTenant());
    setInitialized(true);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    setWebToken(res.token);
    setUser(res.user);
    persistSession(res.token, res.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const res = await apiRegister(email, password, name);
      setWebToken(res.token);
      setUser(res.user);
      persistSession(res.token, res.user);
    },
    []
  );

  const fetchTenants = useCallback(async (): Promise<Tenant[]> => {
    if (!webToken) throw new Error('Not authenticated');
    return getMyTenants(webToken);
  }, [webToken]);

  const selectTenant = useCallback(
    async (selected: Tenant) => {
      if (!webToken) throw new Error('Not authenticated');
      const res = await getTenantToken(webToken, selected.id);
      setTenantToken(res.token);
      setTenant(selected);
      persistTenantSession(res.token, selected);
    },
    [webToken]
  );

  const logout = useCallback(() => {
    clearSession();
    setWebToken(null);
    setTenantToken(null);
    setUser(null);
    setTenant(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      tenant,
      webToken,
      tenantToken,
      isAuthenticated: !!webToken,
      hasTenant: !!tenantToken,
      login,
      register,
      selectTenant,
      fetchTenants,
      logout,
    }),
    [
      user,
      tenant,
      webToken,
      tenantToken,
      login,
      register,
      selectTenant,
      fetchTenants,
      logout,
    ]
  );

  if (!initialized) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
