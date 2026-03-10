/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@monaco-editor/react', 'monaco-editor'],
  webpack(config) {
    config.module.rules.push({
      test: /\.md$/,
      type: 'asset/source',
    });
    return config;
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
