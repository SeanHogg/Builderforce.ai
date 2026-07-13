/** @type {import('next').NextConfig} */
const createNextIntlPlugin = require('next-intl/plugin');

// See https://next-intl-docs.vercel.app/docs/routing
const withNextIntl = createNextIntlPlugin(/* './i18n/request.ts' */);

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.amazonaws.com',
      },
    ],
  },
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/hiredvideo',
    JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    JWT_EXPIRY: process.env.JWT_EXPIRY || '30d',
    REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY || '30d',
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  },
  experimental: {
    // Enable package.json imports
    packageImports: ['@/*'],
  },
};

export default withNextIntl(nextConfig);