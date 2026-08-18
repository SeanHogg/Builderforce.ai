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
  verifyEmailCode as apiVerifyEmailCode,
  selectAccountType as apiSelectAccountType,
  setAvailableForHire as apiSetAvailableForHire,
  type AuthStepResult,
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
  /**
   * Has the stored session been read off the device yet?
   *
   * `false` for the SERVER render and the first hydrated frame — localStorage
   * does not exist on the server, so `isAuthenticated` is unavoidably `false`
   * there for everyone, signed in or not. Anything that ACTS on being signed
   * out (a redirect to /login, opening a guest board instead of a server one)
   * must wait for this, or it fires against a signed-in user. Use the
   * `useRequireAuth` hook rather than re-deriving that rule per page.
   */
  authReady: boolean;
  /** Resolves to `{ needsVerification: true, email }` when the account's email must
   *  be verified first — the caller flips to the code-entry step. Otherwise the
   *  session is set and it resolves to `{ needsVerification: false, ... }`. */
  login: (email: string, password: string) => Promise<AuthStepResult>;
  register: (email: string, password: string, name: string | undefined, agreeToTerms: boolean, accountType?: 'standard' | 'freelancer' | 'sales', referralCode?: string, ageAttested?: boolean) => Promise<AuthStepResult>;
  /** Exchange the emailed OTP for a session (sets the session in place). `trustDevice`
   *  keeps the user signed in on this device for 30 days. */
  verifyEmail: (email: string, code: string, trustDevice: boolean) => Promise<void>;
  /** One-time account-type choice (Build vs Hired) for an OAuth/magic-link account
   *  that hasn't picked a role yet. Updates the stored user in place. */
  selectAccountType: (accountType: 'standard' | 'freelancer' | 'sales', ageAttested: boolean) => Promise<void>;
  /** Opt IN/OUT of being hired talent (independent of account type — the builder
   *  shell is unaffected). Updates the stored user in place. */
  setAvailableForHire: (available: boolean) => Promise<void>;
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebToken(getStoredWebToken());
    setTenantToken(getStoredTenantToken());
    setUser(getStoredUser());
    setTenant(getStoredTenant());
    setInitialized(true);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthStepResult> => {
    const res = await apiLogin(email, password);
    if (!res.needsVerification) {
      setWebToken(res.token);
      setUser(res.user);
      persistSession(res.token, res.user);
    }
    return res;
  }, []);

  const register = useCallback(
    async (email: string, password: string, name: string | undefined, agreeToTerms: boolean, accountType?: 'standard' | 'freelancer' | 'sales', referralCode?: string, ageAttested?: boolean): Promise<AuthStepResult> => {
      const res = await apiRegister(email, password, name, agreeToTerms, accountType, referralCode, ageAttested);
      // Registration returns no session — the email must be verified first — but keep
      // the session-setting branch for forward-compat if that ever changes.
      if (!res.needsVerification) {
        setWebToken(res.token);
        setUser(res.user);
        persistSession(res.token, res.user);
      }
      return res;
    },
    []
  );

  const verifyEmail = useCallback(
    async (email: string, code: string, trustDevice: boolean) => {
      const res = await apiVerifyEmailCode(email, code, trustDevice);
      setWebToken(res.token);
      setUser(res.user);
      persistSession(res.token, res.user);
    },
    []
  );

  const selectAccountType = useCallback(
    async (accountType: 'standard' | 'freelancer' | 'sales', ageAttested: boolean) => {
      if (!webToken) throw new Error('Not authenticated');
      const updated = await apiSelectAccountType(webToken, accountType, ageAttested);
      setUser(updated);
      persistSession(webToken, updated);
    },
    [webToken],
  );

  const setAvailableForHire = useCallback(
    async (available: boolean) => {
      if (!webToken) throw new Error('Not authenticated');
      const next = await apiSetAvailableForHire(webToken, available);
      setUser((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, availableForHire: next };
        persistSession(webToken, updated);
        return updated;
      });
    },
    [webToken],
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
      authReady: initialized,
      login,
      register,
      verifyEmail,
      selectAccountType,
      setAvailableForHire,
      selectTenant,
      fetchTenants,
      logout,
    }),
    [
      user,
      tenant,
      webToken,
      tenantToken,
      initialized,
      login,
      register,
      verifyEmail,
      selectAccountType,
      setAvailableForHire,
      selectTenant,
      fetchTenants,
      logout,
    ]
  );

  // NEVER gate the tree on rehydration. Returning null until the localStorage
  // read completed made the SERVER render of every route — the marketing home
  // page included — an empty document: the only text in the delivered HTML was
  // the skip link. Crawlers, link unfurlers and Google's OAuth branding review
  // therefore saw a blank page with no product name and no description, which
  // reads as "the home page is behind a login". Children render immediately and
  // consumers that must not act on a not-yet-known session gate on `authReady`.
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/**
 * Non-throwing variant: returns null when there is no AuthProvider above. For
 * shared components (e.g. RoleGate) that may render outside the provider (tests,
 * isolated previews) and must degrade gracefully instead of crashing the tree.
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
