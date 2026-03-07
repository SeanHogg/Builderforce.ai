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
        'coral-bright': '#4d9eff',
        'coral-mid': '#3b82f6',
        'coral-dark': '#1e40af',
        'cyan-bright': '#00e5cc',
        'bg-deep': '#050810',
        'bg-surface': '#0a0f1a',
      },
      backgroundImage: {
        'stars': "url('/stars.png')",
        'nebula': "url('/nebula.png')",
      },
    },
  },
  plugins: [],
}
