/**
 * `@seanhogg/builderforce-replay` — npm entry (global `BuilderforceReplay`).
 *
 *   import { startReplay } from '@seanhogg/builderforce-replay';
 *   startReplay({ site: 'bfr_…' });
 *
 * It injects the CDN loader, so the recorder updates without a reinstall.
 * `window.BFReplay` is the runtime API either way.
 */

export { startReplay, type StartReplayOptions } from './npm';
export type { BFReplayApi } from './handoff';
