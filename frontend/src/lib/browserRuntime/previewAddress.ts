/**
 * The address the preview's toolbar SHOWS: `<project>-preview.builderforce.ai/<path>`.
 *
 * The in-browser preview really lives at `preview.builderforce.ai/__bfwc/<session>/…`:
 * one relay origin whose service worker serves every project running in this
 * browser. A host per project is not possible on that design (each origin would need
 * its own relay and worker), and `<project>.preview.builderforce.ai` would need a
 * second-level wildcard certificate that Cloudflare's free plan does not issue.
 * So this is a readable name for the same page, not a second address: the real URL
 * stays in the tooltip and behind "Open in a new tab".
 *
 * A URL that is not a relay preview (a container preview, a published site) is shown
 * as it is.
 */
import { slugify } from '@builderforce/creation-canvas-contract';

const RELAY_PATH = /^\/__bfwc\/[^/]+(\/.*)?$/;

/** Longest slug kept, so a prompt-length project name stays an address. */
const SLUG_MAX = 40;

export function previewDisplayAddress(url: string, projectName: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  const match = RELAY_PATH.exec(parsed.pathname);
  if (!match) return url;
  const path = match[1] ?? '/';
  return `${projectSlug(projectName)}-preview.builderforce.ai${path}${parsed.search}`;
}

/** "Build a marketing website for he-man" → "build-a-marketing-website-for-he-man" (the shared slug rule). */
export function projectSlug(name: string): string {
  return slugify(name, { maxLength: SLUG_MAX, fallback: 'app', foldDiacritics: true });
}
