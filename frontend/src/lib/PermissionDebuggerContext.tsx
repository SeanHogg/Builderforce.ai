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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionStatus = 'granted' | 'denied' | 'soft-gate';

export interface PermissionRegistration {
  id: string;
  permission: string;
  status: PermissionStatus;
  /** Which role/source granted or denied this permission. */
  grantedVia?: string;
  /** Associated API endpoint for tooltip display. */
  apiEndpoint?: string;
  /** Human-readable component name for the panel. */
  componentName?: string;
}

interface PermissionDebuggerContextValue {
  /** Whether the debugger overlay is active. */
  debuggerActive: boolean;
  toggleDebugger: () => void;
  setDebuggerActive: (active: boolean) => void;
  /** Register a PermissionGate with the debugger. */
  registerGate: (reg: PermissionRegistration) => void;
  /** Unregister when unmounted. */
  unregisterGate: (id: string) => void;
  /** All currently registered gates (for the panel). */
  gates: PermissionRegistration[];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PermissionDebuggerContext = createContext<PermissionDebuggerContextValue | null>(null);

export function PermissionDebuggerProvider({ children }: { children: React.ReactNode }) {
  const [debuggerActive, setDebuggerActiveState] = useState(false);
  const [gates, setGates] = useState<PermissionRegistration[]>([]);
  const gatesRef = useRef<Map<string, PermissionRegistration>>(new Map());

  const setDebuggerActive = useCallback((active: boolean) => {
    setDebuggerActiveState(active);
    if (!active) {
      // Clear registrations when debugger is turned off
      gatesRef.current.clear();
      setGates([]);
    }
  }, []);

  const toggleDebugger = useCallback(() => {
    setDebuggerActiveState((prev) => {
      if (prev) {
        gatesRef.current.clear();
        setGates([]);
      }
      return !prev;
    });
  }, []);

  // Keyboard shortcut: Ctrl+Shift+P
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        toggleDebugger();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleDebugger]);

  const registerGate = useCallback((reg: PermissionRegistration) => {
    gatesRef.current.set(reg.id, reg);
    setGates([...gatesRef.current.values()]);
  }, []);

  const unregisterGate = useCallback((id: string) => {
    gatesRef.current.delete(id);
    setGates([...gatesRef.current.values()]);
  }, []);

  const value = useMemo<PermissionDebuggerContextValue>(
    () => ({ debuggerActive, toggleDebugger, setDebuggerActive, registerGate, unregisterGate, gates }),
    [debuggerActive, toggleDebugger, setDebuggerActive, registerGate, unregisterGate, gates],
  );

  return (
    <PermissionDebuggerContext.Provider value={value}>
      {children}
    </PermissionDebuggerContext.Provider>
  );
}

export function usePermissionDebugger(): PermissionDebuggerContextValue {
  const ctx = useContext(PermissionDebuggerContext);
  if (!ctx) throw new Error('usePermissionDebugger must be used within a PermissionDebuggerProvider');
  return ctx;
}
