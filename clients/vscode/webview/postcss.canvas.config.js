/**
 * PostCSS for the CANVAS bundle. Same pipeline as the Brain webview, but Tailwind
 * scans the frontend sources the canvas compiles (see tailwind.canvas.config.js)
 * — otherwise every utility class in those components is purged and the board
 * renders unstyled.
 */
module.exports = {
  plugins: {
    tailwindcss: { config: require('path').join(__dirname, 'tailwind.canvas.config.js') },
    autoprefixer: {},
  },
};
