/**
 * The webview ⇄ extension-host messaging bridge.
 *
 * The React Brain app runs inside a VS Code webview (a Chromium context). It can
 * reach the gateway/API directly over HTTPS (CORS now permits the
 * `vscode-webview://` origin), so streaming + `/api/brain` persistence work with
 * no proxy. The ONLY things it can't do itself are touch the local filesystem and
 * mint a tenant token — those cross this typed postMessage bridge to the host:
 *
 *   webview → host : 'ready', 'token.refresh'{id}, 'signin', 'chats.changed', 'platform.write'{name},
 *                    'run.start'{run} / 'run.stop' / 'run.confirm' / 'run.clearError' /
 *                    'run.autoApprove'{chatId,on} (the host-owned agent loop — see
 *                    hostRunDriver.ts; every verb names its CHAT, because several run at once),
 *                    'open.artifact'{kind,ref,projectId},
 *                    'changes.open'{changePath,changeStatus}, 'changes.review'
 *   host → webview : 'init'{…}, 'token'{token}, 'response'{id,ok,result|error}, 'intent'{intent},
 *                    'editorContext'{editorContext}, 'pendingChanges'{pendingChanges}, 'refresh',
 *                    'run.sync' / 'run.settled' / 'run.failed' / 'run.tool' / 'run.tools' (see onHostMessage)
 *
 * This file is the PUBLIC ENTRY — every caller imports from `./vscodeBridge`. The parts:
 *   bridgeTypes.ts     — `InitData`, `BrainIntent`, `LabelBundle` (pure types)
 *   bridgeTransport.ts — `post`, `request`/`response`, the ONE message listener, `onHostMessage`
 *   bridgeState.ts     — token, `init`, editor context, pending changes, intents, refresh
 *   hostFetch.ts       — the host-proxied streaming fetch (`llm.*` frames)
 */

import { installApiFailureRelay } from './apiFailureRelay';
import { post } from './bridgeTransport';

export type { LabelBundle, BrainIntent, InitData } from './bridgeTypes';
export type { EditorContext } from '../../src/idePersona';
export type { PendingChangeSet } from '../../src/gitChangeModel';
export { post, request, onHostMessage } from './bridgeTransport';
export { hostFetch } from './hostFetch';
export {
  getToken,
  getEditorContext,
  onEditorContext,
  getPendingChanges,
  onPendingChanges,
  onInit,
  onIntent,
  onRefresh,
  onTokenChange,
  refreshToken,
} from './bridgeState';

// Every failed API answer this webview receives goes to the host's output channel,
// where a user can copy the endpoint, status and the API's error reference from.
installApiFailureRelay((failure) => post('api.failure', { ...failure }));

// Announce readiness so the host sends `init`. Done at module load — before React
// mounts — so no init frame is missed. (The imports above have already installed
// every frame handler by the time this runs.)
post('ready');
