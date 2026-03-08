/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
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
