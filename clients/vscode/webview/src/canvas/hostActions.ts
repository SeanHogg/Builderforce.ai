/**
 * The VS Code implementation of the canvas HOST PORT (`@/lib/canvasHost`).
 *
 * Everything here is something only the editor can do: read the active file, the
 * current selection, the problems list, the workspace repository or terminal
 * output; reveal a file; decide what an in-app route means. The canvas asks for
 * them through the port and renders whatever the host offers, so adding an action
 * is a change in ONE place — the host's capture switch — with no matching change
 * on the web.
 *
 * The captures themselves run in the extension host (only it can touch the
 * workspace); this side is a typed request/response wrapper.
 */

import {
  registerCanvasHost,
  type CanvasHost,
  type CanvasHostAction,
  type CanvasHostCapture,
  type CanvasHostRange,
} from '@/lib/canvasHost';
import { post, request, type LabelBundle } from '../vscodeBridge';

/**
 * The capture actions offered in the session bar, in display order. `id` is the
 * contract with the host's `canvas.capture` handler; `labelKey` indexes the
 * host's localized bundle (it translates through `vscode.l10n`, so these strings
 * live in the extension's catalog rather than a web one).
 */
const CAPTURE_ACTIONS: ReadonlyArray<{ id: string; labelKey: string; icon: string }> = [
  { id: 'file', labelKey: 'canvas.addFile', icon: '⎘' },
  { id: 'selection', labelKey: 'canvas.addSelection', icon: '⌗' },
  { id: 'diagnostics', labelKey: 'canvas.addProblems', icon: '⚠' },
  { id: 'repository', labelKey: 'canvas.addRepository', icon: '⑂' },
  { id: 'terminal', labelKey: 'canvas.addTerminal', icon: '›_' },
  { id: 'preview', labelKey: 'canvas.addPreview', icon: '◱' },
];

/** Ask the host to perform a capture. Resolves null when the user cancelled. */
async function capture(id: string): Promise<CanvasHostCapture | null> {
  const result = await request<CanvasHostCapture | null>('canvas.capture', { action: id });
  return result ?? null;
}

/**
 * Install the editor host so `<CanvasHostActions>` becomes visible and every
 * navigation/link routes through VS Code. Called once, before React mounts.
 */
export function installCanvasHost(labels: LabelBundle, webOrigin: string): void {
  const actions: CanvasHostAction[] = CAPTURE_ACTIONS.map(({ id, labelKey, icon }) => ({
    id,
    label: labels[labelKey] ?? labelKey,
    icon,
    run: () => capture(id),
  }));

  const host: CanvasHost = {
    surface: 'vscode',
    actions,
    openFile: (path: string, range?: CanvasHostRange) => post('canvas.openFile', { path, range }),
    // The host decides what a route means here: another Canvas panel, the sign-in
    // command, or the external browser. The webview must never navigate its own
    // document — that blanks the panel with no way back.
    navigate: (path: string) => post('canvas.navigate', { path }),
    webOrigin,
    // The ONNX runtime is deliberately NOT in the VSIX (see the `bf-drop-wasm`
    // plugin). It is served from the BuilderForce origin and fetched the first
    // time someone clones a voice, so the package stays small.
    wasmBaseUrl: `${webOrigin}/ort/`,
  };
  registerCanvasHost(host);
}
