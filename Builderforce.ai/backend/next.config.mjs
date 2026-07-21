/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
  // Allow paths for better-sqlite3
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
  // Environment variables
  env: {
    DB_PATH: '/tmp/builderforce.db',
    DB_TYPE: 'sqlite',
  },
};

export default nextConfig;