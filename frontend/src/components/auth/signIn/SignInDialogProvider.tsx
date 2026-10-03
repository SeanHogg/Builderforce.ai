'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { SignInDialog } from './SignInDialog';

interface SignInDialogContextValue {
  /** Show the sign-in pop-up. A no-op when already signed in. */
  requestSignIn: () => void;
}

const SignInDialogContext = createContext<SignInDialogContextValue | null>(null);

/**
 * Owns the one sign-in pop-up for a subtree (the Studio app), and closes it the
 * moment a session appears, however it arrived: the email form, or a provider
 * pop-up whose session reached this window through `AuthProvider`'s storage sync.
 */
export function SignInDialogProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isAuthenticated) setOpen(false);
  }, [isAuthenticated]);

  const requestSignIn = useCallback(() => {
    if (!isAuthenticated) setOpen(true);
  }, [isAuthenticated]);

  const value = useMemo(() => ({ requestSignIn }), [requestSignIn]);

  return (
    <SignInDialogContext.Provider value={value}>
      {children}
      <SignInDialog open={open && !isAuthenticated} onDismiss={() => setOpen(false)} returnPath={pathname} />
    </SignInDialogContext.Provider>
  );
}

export function useSignInDialog(): SignInDialogContextValue {
  const ctx = useContext(SignInDialogContext);
  if (!ctx) throw new Error('useSignInDialog must be used within a SignInDialogProvider');
  return ctx;
}
