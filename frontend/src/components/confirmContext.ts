/**
 * The confirm primitive's CONTRACT — options, the awaitable `confirm()` and the `useConfirm()` hook — without the dialog,
 * so a host that only calls it (the VS Code webview's chat, checked under its own strict project) imports this file alone.
 * The ONE provider and dialog stay in `ConfirmProvider.tsx`, which re-exports everything here.
 */

import { createContext, useContext } from 'react';

export interface ConfirmOptions {
  /** The body prompt. Required — this is what the user reads before deciding. */
  message: string;
  /** Optional heading above the message. */
  title?: string;
  /** Confirm button label. Defaults (localized) to "Delete". */
  confirmLabel?: string;
  /** Cancel button label. Defaults (localized) to "Cancel". */
  cancelLabel?: string;
  /**
   * Always destructive — the modal exists ONLY for destructive approvals. The flag
   * is accepted as a self-documenting `true` at call sites; `false` is a type error
   * on purpose: a non-destructive action takes a toast (`useToast()`) or the inline
   * two-step `InlineConfirmButton`, never this modal.
   */
  destructive?: true;
}

/** Awaitable confirm: resolves true if the user confirms, false otherwise.
 *  Pass a bare string as shorthand for `{ message }`. */
export type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Returns an awaitable `confirm()` backed by the shared in-app modal.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ message: t('deleteConfirm'), confirmLabel: t('delete') }))) return;
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
