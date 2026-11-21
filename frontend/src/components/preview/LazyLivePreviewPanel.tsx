import dynamic from 'next/dynamic';

/**
 * `LivePreviewPanel`, loaded in the browser only — for hosts that open the preview from
 * client state (the run panel's Preview sub-tab), so `ssr: false` changes no server markup.
 *
 * It exists for the Cloudflare Worker: the edge build inlines every `import()`
 * (`asyncChunks: false`), so a static import of the panel dragged its run targets — the
 * WebContainers runtime and esbuild-wasm — into the route function of every page that
 * reaches the host (/dashboard: ~0.3 MB compressed). See scripts/check-worker-size.mjs.
 */
export const LazyLivePreviewPanel = dynamic(
  () => import('./LivePreviewPanel').then((m) => m.LivePreviewPanel),
  { ssr: false },
);
