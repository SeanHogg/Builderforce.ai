/**
 * The preview hosts, in ONE place (make.md › PRD 31 §4 W10 control 1).
 *
 * - `preview.builderforce.ai` — the shared host: the workspace's relay, and the container
 *   preview ingress (`preview.builderforce.ai/<token>/*`).
 * - `<key>-preview.builderforce.ai` — each browser-run application's own origin, `<key>` being
 *   the runtime package's `previewOriginKey` (32 hex). ONE label under the zone, so the free
 *   Universal SSL `*.builderforce.ai` certificate and the existing `*.builderforce.ai` wildcard
 *   (DNS record + the sites Worker's route) cover it: no second-level wildcard, no Advanced
 *   Certificate. The sites Worker hands these hosts to the API (`subdomainFromHost` reserves
 *   the label), where `presentation/middleware/browserPreviewOrigin.ts` serves them.
 *
 * A leaf with no imports: the sites Worker's import graph reads it.
 */

export const PREVIEW_HOST = 'preview.builderforce.ai';

/** `<key>-preview` — the label of an application's own preview origin. */
const APP_PREVIEW_LABEL = /^([0-9a-f]{32})-preview$/;

/** The host of an application's own preview origin. */
export function appPreviewHost(originKey: string): string {
  return `${originKey}-${PREVIEW_HOST}`;
}

/** True for a label that names an application's preview origin (`<32 hex>-preview`): never a published site. */
export function isAppPreviewLabel(label: string): boolean {
  return APP_PREVIEW_LABEL.test(label);
}

/** The origin key of an app-origin host (`<key>-preview.builderforce.ai`), or null for any other host. */
export function previewOriginKeyOf(host: string | null | undefined): string | null {
  if (typeof host !== 'string') return null;
  const h = host.toLowerCase();
  const suffix = `.${PREVIEW_HOST.slice(PREVIEW_HOST.indexOf('.') + 1)}`;
  if (!h.endsWith(suffix)) return null;
  return APP_PREVIEW_LABEL.exec(h.slice(0, -suffix.length))?.[1] ?? null;
}
