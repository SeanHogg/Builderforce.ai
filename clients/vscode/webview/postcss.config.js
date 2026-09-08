/**
 * PostCSS for THE webview bundle — there is only one now.
 *
 * Tailwind scans the frontend sources this bundle compiles as well as the editor's
 * own `src/`; otherwise every utility class in those components is purged and the
 * board renders unstyled. The chat panel used to have a second, narrower config,
 * but its content globs were a strict subset of these, so it was redundant rather
 * than different.
 */
module.exports = {
  plugins: {
    tailwindcss: { config: require('path').join(__dirname, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
