/**
 * The page's in-browser runtime (BuilderForce WebContainers), booted once and
 * shared: the instant preview, `npm install`, dev servers and the terminal all
 * run on this one instance.
 *
 * Relay mode: the preview is served from `preview.builderforce.ai`, never from
 * the app's own origin — and so are the processes (`node`, `npm`, the shell),
 * which the relay starts on that origin. Canvas projects run AI-written code and
 * arbitrary npm packages; on builderforce.ai they could read the user's session.
 * The API serves the relay page and workers there
 * (`api/src/presentation/middleware/browserPreviewOrigin.ts`).
 *
 * The package is imported lazily, so the editor's bundle pays nothing until Run.
 *
 * No "Built with" badge here: this preview is the builder's own workspace, inside
 * Builderforce already. The badge belongs on the PUBLISHED site, where the platform
 * adds its own ("Made with Builderforce.ai", free tier) — `api/src/application/ide/siteAttribution.ts`.
 */
import type { PreviewRuntime } from '@seanhogg/builderforce-webcontainers';

const RELAY_URL = process.env.NEXT_PUBLIC_PREVIEW_RELAY_URL || 'https://preview.builderforce.ai/__bfwc/relay.html';

let booting: Promise<PreviewRuntime> | null = null;

export function bootSharedPreviewRuntime(): Promise<PreviewRuntime> {
  booting ??= import('@seanhogg/builderforce-webcontainers')
    .then(({ bootPreviewRuntime }) => bootPreviewRuntime({ relayUrl: RELAY_URL, attribution: false }))
    .catch((error: unknown) => {
      booting = null; // a later Run may retry (the relay was unreachable, say)
      throw error;
    });
  return booting;
}

const INSTALLED = '/node_modules/';

/**
 * Make the runtime hold exactly `files` — this project, now — while keeping what
 * `npm install` put in `node_modules`, so an unchanged `package.json` does not
 * reinstall. One runtime serves the page, so the previous run's files (another
 * project, or files deleted since) go first.
 */
export function replaceProjectFiles(runtime: PreviewRuntime, files: Record<string, string>): void {
  for (const path of runtime.fs.list()) {
    if (!path.startsWith(INSTALLED)) runtime.fs.rm(path);
  }
  runtime.mount(files);
}
