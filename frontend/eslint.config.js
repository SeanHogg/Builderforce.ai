// @ts-check
const nextConfig = require('eslint-config-next');
const nextCoreWebVitalsConfig = require('eslint-config-next/core-web-vitals');

/** @type {import('eslint').Linter.Config[]} */
const config = [
  { ignores: ['.next/**', '.vercel/**', 'node_modules/**'] },
  ...nextConfig,
  ...nextCoreWebVitalsConfig,
];

module.exports = config;
