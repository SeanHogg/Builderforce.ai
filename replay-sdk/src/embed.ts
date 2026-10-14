/**
 * `https://cdn.builderforce.ai/embed/v1.js` — the unified embed rail
 * (`unifiedEmbedSnippet()` in `frontend/src/lib/embeddedCapabilities.ts`).
 *
 * Its replay part is the loader: when the tag carries `data-site` (a replay
 * site key), it boots session replay exactly as `/replay/v1/loader.js` does.
 * The workspace key on `data-builderforce-key` belongs to the other embedded
 * capabilities and is never used as a replay key. Without `data-site` this
 * file does nothing for replay.
 */

import { boot } from './loaderBoot';

export function bootEmbed(script: HTMLScriptElement | null = document.currentScript as HTMLScriptElement | null): Promise<void> {
  if (!script || !script.dataset.site) return Promise.resolve();
  return boot({ script });
}

if (typeof document !== 'undefined') void bootEmbed();
