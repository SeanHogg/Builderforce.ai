// @ts-check
const nextConfig = require('eslint-config-next');
const nextCoreWebVitalsConfig = require('eslint-config-next/core-web-vitals');

/** @type {import('eslint').Linter.Config[]} */
const config = [
  { ignores: ['.next/**', '.vercel/**', 'node_modules/**'] },
  ...nextConfig,
  ...nextCoreWebVitalsConfig,
  {
    // eslint-plugin-react-hooks v6 + the React Compiler plugin add several
    // strict ergonomics rules that fire on dozens of pre-existing legitimate
    // patterns (fetch-on-mount, ref-mirror, manual memoization). Demote to
    // warnings so the build doesn't break — they stay visible so we can
    // refactor file-by-file.
    rules: {
      'react-hooks/set-state-in-effect':       'warn',
      'react-hooks/refs':                       'warn',
      'react-hooks/purity':                     'warn',
      'react-hooks/immutability':               'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
];

module.exports = config;
