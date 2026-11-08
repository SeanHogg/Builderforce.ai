import { useSyncExternalStore } from 'react';
import { resolveExportPalette, type ExportPalette } from '@/lib/creation/exportColors';

/**
 * The palette is the same in both themes (paper does not go dark), so it is read once per
 * environment and the snapshot stays referentially stable, as `useSyncExternalStore` needs.
 */
let browserPalette: ExportPalette | null = null;
let serverPalette: ExportPalette | null = null;
const never = () => () => undefined;
const readBrowser = () => (browserPalette ??= resolveExportPalette());
const readServer = () => (serverPalette ??= resolveExportPalette());

/**
 * The export palette as concrete colours for the editor that is open. The server render
 * cannot read a stylesheet, so it gets the unresolved palette and the browser swaps in the
 * resolved one on hydration.
 */
export function useExportPalette(): ExportPalette {
  return useSyncExternalStore(never, readBrowser, readServer);
}
