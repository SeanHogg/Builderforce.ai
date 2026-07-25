import createNextIntlPlugin from 'next-intl/plugin';

// Point the plugin at the request config used by next-intl (locale + messages).
// See https://next-intl-docs.vercel.app/docs/getting-started/app-router
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.amazonaws.com',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
