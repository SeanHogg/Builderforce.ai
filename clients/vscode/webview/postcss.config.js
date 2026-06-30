const path = require('path');

// Vite runs from the extension root, so point Tailwind at THIS folder's config
// (otherwise it falls back to an empty content set and emits no utilities).
module.exports = {
  plugins: {
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
