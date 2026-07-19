'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

export interface ConfirmOptions {
  /** The body prompt. Required — this is what the user reads before deciding. */
  message: string;
  /** Optional heading above the message. */
  title?: string;
  /** Confirm button label. Defaults (localized) to "Delete". */
  confirmLabel?: string;
  /** Cancel button label. Defaults (localized) to "Cancel". */
  cancelLabel?: string;
  /** Destructive (default) → coral button; false → neutral accent button. */
  destructive?: boolean;
}

/** Awaitable confirm: resolves true if the user confirms, false otherwise.
 *  Pass a bare string as shorthand for `{ message }`. */
export type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * App-wide provider for the promise-based `useConfirm()` hook. Mounts ONE shared
 * {@link ConfirmDialog} and hands descendants an awaitable `confirm()` so every
 * call site replaces the browser-native `window.confirm()` with the in-app modal
 * via a minimal-diff `if (!(await confirm(...))) return;`. Mounted once at the
 * app root (see app/layout.tsx) — never per-feature.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((raw) => {
    const next = typeof raw === 'string' ? { message: raw } : raw;
    setOpts(next);
    return new Promise<boolean>((resolve) => { resolverRef.current = resolve; });
  }, []);

  const settle = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={opts !== null}
        message={opts?.message ?? ''}
        title={opts?.title}
        confirmLabel={opts?.confirmLabel}
        cancelLabel={opts?.cancelLabel}
        destructive={opts?.destructive ?? true}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * Returns an awaitable `confirm()` backed by the shared in-app modal.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ message: t('deleteConfirm'), destructive: true }))) return;
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
