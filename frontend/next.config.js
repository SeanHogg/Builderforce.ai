/** @type {import('next').NextConfig} */
const createNextIntlPlugin = require('next-intl/plugin');
const path = require('path');
const { version } = require('./package.json');

/**
 * The Node-safe entry of `hast-util-from-html-isomorphic`, resolved once here.
 *
 * That package ships two builds behind export conditions: `browser` uses the
 * DOM (`const parser = new DOMParser()` at MODULE SCOPE), and the default entry
 * uses a pure-JS parser. Next's edge build activates `browser` but NOT `worker`,
 * so every edge route whose graph reaches `rehype-katex` — via our one
 * `markdownPipeline`, and mathematics can appear in markdown anywhere — imported
 * the DOM build into a runtime with no `DOMParser` and threw
 * `ReferenceError: DOMParser is not defined` while EVALUATING the module, before
 * a line of React ran. `/[burnrateDomain]` is the catch-all, so the visible
 * symptom was that every unmatched URL on the site answered 500 instead of the
 * 404 page — `/favicon.ico` included.
 *
 * Resolved from `rehype-katex`'s real directory because pnpm does not hoist it,
 * and by `require.resolve` (whose conditions pick `default`) rather than a
 * hardcoded `.pnpm/<name>@<version>/` path that a bump would silently break.
 */
const nodeSafeFromHtmlIsomorphic = require.resolve(
  'hast-util-from-html-isomorphic',
  { paths: [require('fs').realpathSync(path.join(__dirname, 'node_modules/rehype-katex'))] },
);

/**
 * The same entry, expressed relative to the project root.
 *
 * `turbopack.resolveAlias` interprets every value as project-relative, so the
 * absolute path above arrives as `./repo/frontend/...` and fails to resolve
 * ("server relative imports are not implemented yet"). Only the webpack alias
 * may take the absolute form.
 */
const nodeSafeFromHtmlIsomorphicRelative =
  './' + path.relative(__dirname, nodeSafeFromHtmlIsomorphic).split(path.sep).join('/');

// next-intl: points the plugin at the per-request locale/message resolver.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
/**
 * Dev-only `connect-src` additions.
 *
 * It was the single literal `http://localhost:8787`, and a local API on any
 * other port was blocked by CSP with no clue in the failure: the request never
 * leaves the page, so the console says "refused to connect" and the feature
 * (guest chat, the diagnostics catalog, anything through the gateway) just does
 * nothing. `wrangler dev` picks a free port when 8787 is taken, and the api,
 * agent-runtime and worker packages each run one — so pinning one number was
 * always going to be wrong for somebody.
 *
 * Any loopback port and scheme, development only. Production keeps `'self'
 * https: wss:` exactly as before, so this loosens nothing that ships.
 */
const developmentConnectOrigins = process.env.NODE_ENV === 'development'
  ? ' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*'
  : '';

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  // Cloudflare Pages (next-on-pages) does not run Next's default image
  // optimizer endpoint (/_next/image), so optimized <Image> requests 404 and
  // render broken. Serve images unoptimized — they emit plain <img src> tags.
  images: { unoptimized: true },
  transpilePackages: ['@monaco-editor/react', 'monaco-editor', '@seanhogg/builderforce-studio', '@seanhogg/builderforce-studio-embedded', '@seanhogg/builderforce-sdk', '@seanhogg/builderforce-brain-ui'],
  // Turbopack powers local development. Keep its behavior aligned with the
  // webpack production build below: resolve linked workspace packages from the
  // monorepo root, load blog Markdown as source text, and prevent browser
  // bundles from following Transformers.js into Node-only native bindings.
  turbopack: {
    root: path.join(__dirname, '..'),
    rules: {
      '*.md': {
        loaders: [path.join(__dirname, 'scripts/rawContentLoader.cjs')],
        as: '*.js',
      },
    },
    resolveAlias: {
      // Turbopack resolves linked packages from their physical workspace paths,
      // where pnpm's host-created dependency symlinks are not valid inside the
      // Linux container. Route their runtime imports back through the canonical
      // frontend dependency graph (the same behavior webpack's symlinks:false
      // provides below).
      '@huggingface/transformers': './node_modules/@huggingface/transformers/dist/transformers.web.js',
      '@seanhogg/builderforce-brain-embedded': '../brain-embedded/dist/index.mjs',
      '@seanhogg/builderforce-sdk': '../sdk/dist/index.mjs',
      '@seanhogg/builderforce-studio': '../studio/dist/index.mjs',
      '@seanhogg/builderforce-studio-embedded': '../studio-embedded/dist/index.mjs',
      'mp4-muxer': './node_modules/mp4-muxer/build/mp4-muxer.mjs',
      'onnxruntime-node': './src/lib/turbopackEmptyModule.ts',
      'onnxruntime-web': './node_modules/onnxruntime-web/dist/ort.bundle.min.mjs',
      // Same DOM-build problem as the webpack alias below; dev runs turbopack, and
      // turbopack aliases are global rather than per-runtime. The default entry
      // works in every runtime, so the only cost is a slightly larger dev client
      // bundle — and dev SSR now behaves like production.
      'hast-util-from-html-isomorphic': nodeSafeFromHtmlIsomorphicRelative,
      'react-markdown': './node_modules/react-markdown/index.js',
      'remark-gfm': './node_modules/remark-gfm/index.js',
      sharp: './src/lib/turbopackEmptyModule.ts',
    },
  },
  webpack(config, { isServer, webpack }) {
    config.module.rules.push({
      test: /\.md$/,
      type: 'asset/source',
    });
    // pnpm + linked workspace packages: when webpack follows the symlinked
    // package into its real .pnpm/<hash>/ location, peer-dep resolution
    // from that deep path fails to find sibling packages. symlinks:false
    // keeps the symlink path during resolution so module lookup walks the
    // declared path's parents — which are inside frontend/node_modules
    // where both packages exist together.
    config.resolve.symlinks = false;
    // @huggingface/transformers (pulled in transitively by the linked
    // @seanhogg/builderforce-studio voice/video engine) ships a Node build that
    // imports the native `onnxruntime-node` binding and `sharp`. Neither is
    // usable in the browser/edge bundle this app ships — webpack chokes trying
    // to parse the `.node` binaries. Stub both to `false` so the bundle uses the
    // browser inference path (onnxruntime-web, a studio peerDependency) instead.
    // This is the transformers.js-recommended Next.js config.
    config.resolve.alias = {
      ...config.resolve.alias,
      'onnxruntime-node$': false,
      // Linked packages have their own development installs. With
      // `symlinks:false`, resolving `onnxruntime-web` from one of those packages
      // can pair that nested runtime with a different hoisted
      // `onnxruntime-common`, causing missing-export failures at build time.
      // Keep every browser consumer on the frontend's pinned, self-contained
      // bundle, matching the Turbopack alias above.
      'onnxruntime-web$': path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort.bundle.min.mjs'),
      sharp$: false,
      // Server AND edge only: the browser build of this package touches the DOM
      // at module scope and cannot be evaluated in either. The client bundle is
      // deliberately left alone — the browser build exists to keep that bundle
      // small, and the browser is the one place it is correct.
      ...(isServer ? { 'hast-util-from-html-isomorphic$': nodeSafeFromHtmlIsomorphic } : {}),
    };
    // @webdit/runtime's bundle.ts exports loadBundleFromDir — a Node-side
    // loader used only by its own integration tests — alongside the
    // browser-safe loadBundle/loadBundleFromBuffers this app actually calls.
    // Its dynamic import("node:fs/promises")/("node:path") are never reached
    // at runtime in the browser bundle (same reason onnxruntime-node/sharp are
    // stubbed above), but webpack still needs to resolve every export of a
    // module it pulls in — and a `node:`-scheme specifier is handled by a
    // separate scheme-resolution path that `resolve.alias` cannot intercept,
    // unlike the bare `fs`/`path` core-module fallback. IgnorePlugin replaces
    // the matched request with an empty module before that path is reached.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^node:(fs\/promises|path)$/ }));
    // Silence unactionable "Critical dependency" warnings emitted from inside
    // third-party deps we don't control: @huggingface/transformers uses a
    // dynamic `require(expr)` and reads `import.meta` directly, and
    // @seanhogg/builderforce-memory's HF publish path does the same. These are
    // browser/edge-unused code paths (stubbed above) — the warnings are pure
    // noise and cannot be fixed in our source, so filter them out.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { message: /Critical dependency: the request of a dependency is an expression/ },
      { message: /Critical dependency: Accessing import\.meta directly is unsupported/ },
    ];
    return config;
  },
  async redirects() {
    // Rebrand: the CoderClaw marketing route moved to /agents (BuilderForce Agents).
    return [
      { source: '/coderclaw', destination: '/agents', permanent: true },
      { source: '/coderclaw/:path*', destination: '/agents/:path*', permanent: true },
      // The guided demo deck moved from /marketing to /demo.
      { source: '/marketing', destination: '/demo', permanent: true },
      // Preserve published documentation links to public pages that moved.
      { source: '/privacy', destination: '/legal/privacy-rights', permanent: true },
      { source: '/showcase', destination: '/agents/showcase', permanent: true },
      { source: '/trust', destination: '/legal/compliance', permanent: true },
      // Workforce sub-views replaced the old standalone routes. Keep published
      // blog links and external bookmarks working while preserving the tab.
      { source: '/chats', destination: '/workforce?tab=chats', permanent: true },
      { source: '/approvals', destination: '/workforce?tab=approvals', permanent: true },
    ]
  },
  async headers() {
    return [
      // WebContainer connect route: must NOT be cross-origin isolated so the
      // preview tab can complete the connect handshake with the IDE. BOTH COOP
      // and COEP must be relaxed — COOP:same-origin (inherited from the catch-all
      // below) severs the opener/postMessage bridge setupConnect needs. The
      // catch-all's negative-lookahead also excludes this path so it can't re-add
      // same-origin (Next applies every matching rule).
      // @see https://github.com/stackblitz/webcontainer-core/issues/1725
      {
        source: '/webcontainer/connect/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
        ],
      },
      {
        // Pages + assets: COOP required for popups; COEP=credentialless allows
        // cross-origin fonts/images while still enabling SharedArrayBuffer (WebGPU).
        // Excludes /webcontainer/connect (served non-isolated, rule above).
        source: '/((?!api/|webcontainer/connect).*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
      {
        // Baseline security hardening (L2): clickjacking protection + a pragmatic
        // CSP. Deliberately EXCLUDES /embed — those routes are framed cross-origin
        // by host apps (BurnRateOS, the VS Code webview) and set their OWN
        // `frame-ancestors` CSP in middleware.ts; adding X-Frame-Options:SAMEORIGIN
        // or frame-ancestors 'self' here would break that framing. /embed keeps the
        // COOP/COEP rule above but is left out of this one so middleware stays
        // authoritative for its framing. api/ and webcontainer/connect are excluded
        // as before.
        source: '/((?!api/|webcontainer/connect|embed).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            // Pragmatic (non-nonce) CSP: strict enough to block frame-based
            // clickjacking, base-tag hijacking and plugin/object injection, while
            // permissive enough for what the app genuinely loads —
            //   • GTM/GA (script + connect + noscript frame)
            //   • Cloudflare Web Analytics (static.cloudflareinsights.com/beacon.min.js) —
            //     auto-injected by Cloudflare into responses from the deployed Worker,
            //     so it is never in our source and must be allowlisted here or every
            //     page logs a CSP violation. Its RUM POST is covered by `connect-src https:`.
            //   • WASM + blob workers (onnxruntime-web, Monaco, transformers.js, WebContainer)
            //   • the in-browser IDE preview frames (*.webcontainer-api.io / *.staticblitz.com)
            //   • WebRTC/relay sockets (wss:) for meetings, execution steering, live rooms
            // 'unsafe-inline' is required because the app styles via inline
            // style={} and injects inline <script> (theme anti-FOUC, GTM loader);
            // a nonce CSP is impractical across the statically-prerendered shell.
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://www.googletagmanager.com https://www.google-analytics.com https://ssl.google-analytics.com https://static.cloudflareinsights.com",
              // Fonts are system stacks (`--font-sans` in globals.css) plus
              // JetBrains Mono self-hosted by `next/font/google`, so 'self' is
              // the whole font surface — no third-party font origin is loaded.
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self' data:",
              "img-src 'self' data: blob: https:",
              "media-src 'self' blob: data: https:",
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
              // `https:` is what lets the Creation Canvas frame an arbitrary web
              // page in a Web page panel — the feature IS "load any page onto the
              // board", so no allowlist can express it. Each frame is sandboxed
              // and cross-origin, so it reads nothing of ours; our own
              // clickjacking protection is `frame-ancestors`, which is unchanged.
              "frame-src 'self' blob: https: https://www.googletagmanager.com https://*.webcontainer-api.io https://*.staticblitz.com",
              `connect-src 'self' https: wss:${developmentConnectOrigins}`,
              "manifest-src 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = withNextIntl(nextConfig)
