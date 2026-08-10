const path = require('path');

/**
 * Tailwind for the canvas bundle.
 *
 * Content globs cover the frontend components this bundle compiles, and the theme
 * mirrors `frontend/tailwind.config.js` EXACTLY — including the gray-scale remap
 * onto the design-system surface tokens. That remap is not cosmetic: canvas
 * components use `text-gray-100` / `bg-gray-900` expecting them to resolve to
 * theme variables, so dropping it would paint light text on light surfaces in
 * whichever theme the editor is using.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: [
    path.join(__dirname, 'canvas.html'),
    path.join(__dirname, 'src/**/*.{ts,tsx}'),
    path.join(__dirname, '../../../frontend/src/components/**/*.{js,ts,jsx,tsx,mdx}'),
    path.join(__dirname, '../../../frontend/src/lib/**/*.{js,ts,jsx,tsx,mdx}'),
  ],
  theme: {
    extend: {
      colors: {
        'coral-bright': 'var(--coral-bright)',
        'coral-mid': 'var(--coral-mid)',
        'coral-dark': 'var(--coral-dark)',
        'cyan-bright': 'var(--cyan-bright)',
        gray: {
          50: 'var(--text-primary)',
          100: 'var(--text-primary)',
          200: 'var(--text-primary)',
          300: 'var(--text-secondary)',
          400: 'var(--text-secondary)',
          500: 'var(--text-muted)',
          600: 'var(--text-muted)',
          700: 'var(--border-subtle)',
          800: 'var(--bg-elevated)',
          900: 'var(--bg-surface)',
          950: 'var(--bg-deep)',
        },
      },
    },
  },
  plugins: [],
};
