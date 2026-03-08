/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand tokens — map to CSS variables so both dark + light themes work
        'coral-bright': 'var(--coral-bright)',
        'coral-mid': 'var(--coral-mid)',
        'coral-dark': 'var(--coral-dark)',
        'cyan-bright': 'var(--cyan-bright)',

        // Override gray scale to use the design-system surface tokens
        // This means bg-gray-950, bg-gray-900 etc all adapt to light/dark
        gray: {
          50: 'var(--text-primary)',      // lightest text
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
}
