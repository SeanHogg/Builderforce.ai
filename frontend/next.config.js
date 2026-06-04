/** @type {import('next').NextConfig} */
const { version } = require('./package.json');

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  outputFileTracingRoot: __dirname,
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
    return config;
  },
  async redirects() {
    // Rebrand: the CoderClaw marketing route moved to /agents (BuilderForce Agents).
    return [
      { source: '/coderclaw', destination: '/agents', permanent: true },
      { source: '/coderclaw/:path*', destination: '/agents/:path*', permanent: true },
    ]
  },
  async headers() {
    return [
      // WebContainer connect route: must NOT be cross-origin isolated so the
      // preview tab can complete the connect handshake with the IDE.
      // @see https://github.com/stackblitz/webcontainer-core/issues/1725
      {
        source: '/webcontainer/connect/:path*',
        headers: [
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
        ],
      },
      {
        // Pages + assets: COOP required for popups; COEP=credentialless allows
        // cross-origin fonts/images while still enabling SharedArrayBuffer (WebGPU).
        source: '/((?!api/).*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
