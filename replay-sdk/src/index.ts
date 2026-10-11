/**
 * `@seanhogg/builderforce-replay` — npm entry.
 *
 * `init()` starts recording (CDN self-update when a newer hashed recorder is
 * published). `window.BuilderForce.session` is the same API as the snippet.
 */

export { VISIT_IDLE_MS, VISITOR_ID_PATTERN, getVisitId, getVisitorId, mintId } from './ids';
export { unmask, shouldMask, maskInputFn } from './masking';
export { session, installGlobal, type ReplayInit, type ReplaySessionApi } from './publicApi';
export { initFromCdn as init } from './npm';
export { startRecorder } from './recorder';
export { boot as bootLoader } from './loader';
export { bootEmbed } from './embed';

import { initFromCdn } from './npm';
import { installGlobal, session } from './publicApi';

if (typeof window !== 'undefined') installGlobal();

const api = {
  init: initFromCdn,
  identify: session.identify,
  setTag: session.setTag,
  track: session.track,
  stop: session.stop,
  unmask: session.unmask,
};

export default api;
