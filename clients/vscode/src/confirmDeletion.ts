/**
 * Destructive-delete gate used by `builderforce.deleteSession`.
 *
 * Two paths, both modal so a stray Enter/click cannot wipe a chat:
 *   - the conversation is executing → warn "Stop the execution to delete."
 *     and refuse. The run must be stopped first; we never delete under it.
 *   - otherwise → confirm "Delete “{title}”? This cannot be undone."
 *     Proceed only when the user picks Delete.
 *
 * The UI is injected so this module stays vscode-free and unit-testable.
 */

/** The warning surface (vscode.window in production). */
export interface DeletionPromptUi {
  showWarningMessage(
    message: string,
    options: { modal: true },
    ...items: string[]
  ): ThenableLike<string | undefined>;
}

type ThenableLike<T> = PromiseLike<T> | Promise<T>;

export type L10nT = (message: string, ...args: Array<string | number>) => string;

/** Source strings — also the keys in `l10n/bundle.l10n*.json`. */
export const DELETE_ACTION = "Delete";
export const DELETE_CONFIRM = "Delete “{0}”? This cannot be undone.";
export const STOP_EXECUTION_TO_DELETE = "Stop the execution to delete.";

/** `{0}`-style interpolation matching vscode.l10n.t's default catalog. */
export function interpolate(message: string, ...args: Array<string | number>): string {
  return args.reduce<string>((acc, arg, i) => acc.replaceAll(`{${i}}`, String(arg)), message);
}

/**
 * @returns true only when the user confirmed a non-executing delete.
 */
export async function confirmDestructiveDelete(opts: {
  subject: string;
  executing: boolean;
  ui: DeletionPromptUi;
  t?: L10nT;
}): Promise<boolean> {
  const t = opts.t ?? interpolate;
  if (opts.executing) {
    await opts.ui.showWarningMessage(t(STOP_EXECUTION_TO_DELETE), { modal: true });
    return false;
  }
  const action = t(DELETE_ACTION);
  const picked = await opts.ui.showWarningMessage(t(DELETE_CONFIRM, opts.subject), { modal: true }, action);
  return picked === action;
}
