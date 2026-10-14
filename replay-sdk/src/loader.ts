/**
 * Stable CDN loader — `https://cdn.builderforce.ai/replay/v1/loader.js` (D5).
 *
 *   <script async src="https://cdn.builderforce.ai/replay/v1/loader.js" data-site="bfr_…"></script>
 *
 * The URL never changes; the config answer names the recorder to inject.
 * All the work is in `loaderBoot.ts` (shared with `embed/v1.js` and tests).
 */

import { boot } from './loaderBoot';

if (typeof document !== 'undefined') void boot();
