import nextConfig from 'eslint-config-next';
import nextCoreWebVitalsConfig from 'eslint-config-next/core-web-vitals';

const config = [
  { ignores: ['.next/**', '.vercel/**', 'node_modules/**'] },
  ...nextConfig,
  ...nextCoreWebVitalsConfig,
];

export default config;
