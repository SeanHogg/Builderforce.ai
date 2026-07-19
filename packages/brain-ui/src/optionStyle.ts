/**
 * nativeOptionStyle — the opaque bg/fg pair EVERY native `<option>` in this
 * package must carry.
 *
 * The option popup is painted by the OS/webview and IGNORES the translucent
 * surface tokens the `<select>` itself uses; options only inherit `color`, so a
 * dark-theme text colour lands on a default light popup (light-on-white,
 * unreadable). The cascade below ends in the `Canvas`/`CanvasText` system-colour
 * pair — always a legible opaque duo, and it follows the OS light/dark setting —
 * with the VS Code dropdown tokens preferred when rendered inside the webview.
 *
 * Applies to raw `<select>`/`<option>` only. The web app has a richer answer:
 * `frontend/src/components/Select.tsx` renders its own portaled themed popup.
 */
import type { CSSProperties } from 'react';

export const nativeOptionStyle: CSSProperties = {
  background: 'var(--bf-ev-surface-solid, var(--bg-surface, var(--vscode-dropdown-background, Canvas)))',
  color: 'var(--bf-ev-text, var(--text-primary, var(--vscode-dropdown-foreground, CanvasText)))',
};
