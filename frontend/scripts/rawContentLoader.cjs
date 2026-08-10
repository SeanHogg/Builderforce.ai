/**
 * Minimal webpack-compatible loader used by Turbopack for Markdown imports.
 * Keeping this local avoids a dependency tree for a one-line transformation.
 */
module.exports = function rawContentLoader(source) {
  return `export default ${JSON.stringify(source)};`;
};
