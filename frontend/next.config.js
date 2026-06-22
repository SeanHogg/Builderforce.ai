/** @type {import('next').NextConfig} */
const { version } = require('./package.json');

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  outputFileTracingRoot: __dirname,
  // Cloudflare Pages (next-on-pages) does not run Next's default image
  // optimizer endpoint (/_next/image), so optimized <Image> requests 404 and
  // render broken. Serve images unoptimized — they emit plain <img src> tags.
  images: { unoptimized: true },
  transpilePackages: ['@monaco-editor/react', 'monaco-editor', '@seanhogg/builderforce-studio', '@seanhogg/builderforce-studio-embedded', '@seanhogg/builderforce-sdk'],
  webpack(config) {
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
      sharp$: false,
    };
    return config;
  },
  async redirects() {
    // Rebrand: the CoderClaw marketing route moved to /agents (BuilderForce Agents).
    return [
      { source: '/coderclaw', destination: '/agents', permanent: true },
      { source: '/coderclaw/:path*', destination: '/agents/:path*', permanent: true },
    ]
  },
  async rewrites() {
    // /docs/* is the Astro Starlight site, deployed as a SEPARATE Cloudflare
    // Pages project (`builderforce-docs`). The apex builderforce.ai is a Pages
    // custom domain bound to THIS Next worker, which otherwise answers /docs/*
    // with its own 404. Reverse-proxy those requests (same-origin, no redirect)
    // to the docs deployment.
    //
    // IMPORTANT: we STRIP the /docs prefix when forwarding. Astro `base: '/docs'`
    // only prefixes the emitted *links/assets* (so in-page URLs are /docs/*); it
    // does NOT nest the build *output* — content is written to dist root and
    // therefore served at the pages.dev ROOT (pages.dev/agents, not /docs/agents).
    // So /docs/agents must map to pages.dev/agents. Assets referenced as
    // /docs/_astro/* likewise resolve via the strip to pages.dev/_astro/*.
    return [
      { source: '/docs', destination: 'https://builderforce-docs.pages.dev/' },
      { source: '/docs/:path*', destination: 'https://builderforce-docs.pages.dev/:path*' },
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
    ]
  },
}

module.exports = nextConfig
