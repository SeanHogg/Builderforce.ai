/**
 * The page's in-browser preview runtime (BuilderForce WebContainers), booted once
 * and shared, like `webcontainerSession.ts` is for StackBlitz.
 *
 * Relay mode: the preview is served from `preview.builderforce.ai`, never from
 * the app's own origin. Canvas previews run AI-written code and arbitrary npm
 * packages; on builderforce.ai they could read the user's session. The API serves
 * the relay page and worker there (`api/src/presentation/middleware/browserPreviewOrigin.ts`).
 *
 * The package is imported lazily, so the editor's bundle pays nothing until Run.
 */
import type { PreviewRuntime } from '@seanhogg/builderforce-webcontainers';

const RELAY_URL = process.env.NEXT_PUBLIC_PREVIEW_RELAY_URL || 'https://preview.builderforce.ai/__bfwc/relay.html';

let booting: Promise<PreviewRuntime> | null = null;

export function bootSharedPreviewRuntime(): Promise<PreviewRuntime> {
  booting ??= import('@seanhogg/builderforce-webcontainers')
    .then(({ bootPreviewRuntime }) => bootPreviewRuntime({ relayUrl: RELAY_URL }))
    .catch((error: unknown) => {
      booting = null; // a later Run may retry (the relay was unreachable, say)
      throw error;
    });
  return booting;
}
