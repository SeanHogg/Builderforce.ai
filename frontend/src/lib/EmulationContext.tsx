'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { adminApi, type ImpersonationSession } from './adminApi';
import { setEmulationToken, clearEmulationToken } from './apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmulationState {
  sessionId: string;
  emulationToken: string;
  targetUserId: string;
  targetEmail: string;
  targetDisplayName: string | null;
  tenantId: number;
  tenantName: string;
  role: string;
  startedAt: Date;
  expiresAt: Date;
}

interface EmulationContextValue {
  emulation: EmulationState | null;
  startEmulation: (session: ImpersonationSession, emulationToken: string) => void;
  endEmulation: () => Promise<void>;
  switchRole: (newRole: string) => Promise<void>;
  /** Toast messages to display (TTL warnings, etc.) — consumed and cleared by the EmulationBar. */
  toasts: string[];
  dismissToast: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const EmulationContext = createContext<EmulationContextValue | null>(null);

export function EmulationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Memory-only — never written to localStorage; cleared on page reload intentionally.
  const [emulation, setEmulation] = useState<EmulationState | null>(null);
  const [toasts, setToasts] = useState<string[]>([]);
  // Keep a mutable ref so endEmulation / switchRole (event handlers) always
  // see the latest sessionId without re-creating their closures every render.
  const emulationRef = useRef<EmulationState | null>(null);
  useEffect(() => { emulationRef.current = emulation; }, [emulation]);
  const warnedRef = useRef<Set<string>>(new Set());

  // ---------------------------------------------------------------------------
  // Browser tab title suffix
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!emulation) {
      document.title = document.title.replace(/ — \[Emulating:.*?\]$/, '');
      return;
    }
    const suffix = ` — [Emulating: ${emulation.targetEmail} | ${emulation.role}]`;
    const base = document.title.replace(/ — \[Emulating:.*?\]$/, '');
    document.title = base + suffix;
    return () => {
      document.title = document.title.replace(/ — \[Emulating:.*?\]$/, '');
    };
  }, [emulation]);

  // ---------------------------------------------------------------------------
  // TTL warning toasts (T-10, T-5) and auto-end on expiry
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!emulation) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const msLeft = emulation.expiresAt.getTime() - now;
      const minLeft = Math.floor(msLeft / 60000);

      if (msLeft <= 0) {
        clearInterval(interval);
        clearEmulationToken();
        setEmulation(null);
        setToasts((prev) => [...prev, 'Emulation session expired. You have been returned to the admin console.']);
        router.push('/admin');
        return;
      }

      if (minLeft <= 5 && !warnedRef.current.has('t5')) {
        warnedRef.current.add('t5');
        setToasts((prev) => [...prev, 'Emulation session expires in 5 minutes.']);
      } else if (minLeft <= 10 && !warnedRef.current.has('t10')) {
        warnedRef.current.add('t10');
        setToasts((prev) => [...prev, 'Emulation session expires in 10 minutes.']);
      }
    }, 30000); // check every 30s

    return () => clearInterval(interval);
  }, [emulation, router]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const startEmulation = useCallback(
    (session: ImpersonationSession, emulationToken: string) => {
      warnedRef.current.clear();
      setEmulationToken(emulationToken);
      setEmulation({
        sessionId:         session.id,
        emulationToken,
        targetUserId:      session.targetUserId,
        targetEmail:       session.targetEmail,
        targetDisplayName: session.targetDisplayName,
        tenantId:          session.tenantId,
        tenantName:        session.tenantName,
        role:              session.roleOverride,
        startedAt:         new Date(session.startedAt),
        expiresAt:         new Date(session.expiresAt),
      });
    },
    [],
  );

  const endEmulation = useCallback(async () => {
    const current = emulationRef.current;
    if (!current) return;
    const duration = Math.floor((Date.now() - current.startedAt.getTime()) / 1000);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    try {
      await adminApi.impersonationEnd(current.sessionId);
    } finally {
      clearEmulationToken();
      setEmulation(null);
      setToasts((prev) => [
        ...prev,
        `Emulation session ended. Duration: ${mins}m ${secs}s.`,
      ]);
    }
  }, []);

  const switchRole = useCallback(async (newRole: string) => {
    const current = emulationRef.current;
    if (!current) return;
    const res = await adminApi.impersonationSwitchRole(current.sessionId, newRole);
    setEmulationToken(res.emulationToken);
    setEmulation((prev) =>
      prev ? { ...prev, role: newRole, emulationToken: res.emulationToken } : null,
    );
  }, []);

  const dismissToast = useCallback((msg: string) => {
    setToasts((prev) => prev.filter((t) => t !== msg));
  }, []);

  const value = useMemo<EmulationContextValue>(
    () => ({ emulation, startEmulation, endEmulation, switchRole, toasts, dismissToast }),
    [emulation, startEmulation, endEmulation, switchRole, toasts, dismissToast],
  );

  return (
    <EmulationContext.Provider value={value}>
      {children}
    </EmulationContext.Provider>
  );
}

export function useEmulation(): EmulationContextValue {
  const ctx = useContext(EmulationContext);
  if (!ctx) throw new Error('useEmulation must be used within an EmulationProvider');
  return ctx;
}
