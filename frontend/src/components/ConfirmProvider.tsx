'use client';

import React, { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from './confirmContext';

export { useConfirm, type ConfirmFn, type ConfirmOptions } from './confirmContext';

/**
 * App-wide provider for the promise-based `useConfirm()` hook. Mounts ONE shared
 * {@link ConfirmDialog} and hands descendants an awaitable `confirm()` so every
 * call site replaces the browser-native `window.confirm()` with the in-app modal
 * via a minimal-diff `if (!(await confirm(...))) return;`. Mounted once at the
 * app root (see app/layout.tsx) — never per-feature.
 *
 * Destructive approvals only (delete, send to real recipients, move money, remove
 * access). Anything that loses nothing uses a toast or `InlineConfirmButton`.
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
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}
