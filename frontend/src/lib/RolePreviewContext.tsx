'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreviewRole = 'owner' | 'manager' | 'developer' | 'viewer';

interface RolePreviewContextValue {
  /** Active preview role, or null when not in preview mode. */
  previewRole: PreviewRole | null;
  /** Start frontend-only role preview. No API call is made. */
  startPreview: (role: PreviewRole) => void;
  /** Exit role preview and restore the user's own context. */
  exitPreview: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const RolePreviewContext = createContext<RolePreviewContextValue | null>(null);

export function RolePreviewProvider({ children }: { children: React.ReactNode }) {
  // Memory-only — never persisted. Page reload exits preview.
  const [previewRole, setPreviewRole] = useState<PreviewRole | null>(null);

  const startPreview = useCallback((role: PreviewRole) => {
    setPreviewRole(role);
  }, []);

  const exitPreview = useCallback(() => {
    setPreviewRole(null);
  }, []);

  const value = useMemo<RolePreviewContextValue>(
    () => ({ previewRole, startPreview, exitPreview }),
    [previewRole, startPreview, exitPreview],
  );

  return (
    <RolePreviewContext.Provider value={value}>
      {children}
    </RolePreviewContext.Provider>
  );
}

export function useRolePreview(): RolePreviewContextValue {
  const ctx = useContext(RolePreviewContext);
  if (!ctx) throw new Error('useRolePreview must be used within a RolePreviewProvider');
  return ctx;
}
