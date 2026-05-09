// @ts-check
const nextConfig = require('eslint-config-next');
const nextCoreWebVitalsConfig = require('eslint-config-next/core-web-vitals');

/** @type {import('eslint').Linter.Config[]} */
const config = [
  { ignores: ['.next/**', '.vercel/**', 'node_modules/**'] },
  ...nextConfig,
  ...nextCoreWebVitalsConfig,
  {
    // eslint-plugin-react-hooks v6 adds two ergonomics rules that fire on
    // dozens of pre-existing legitimate patterns (fetch-on-mount, ref-mirror).
    // Demote to warnings so the build doesn't break — leave them visible so
    // we can refactor file-by-file.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
];

module.exports = config;
