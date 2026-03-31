import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // VLP design tokens mapped to Tailwind
        brand: {
          orange: '#f97316',
          amber: '#f59e0b',
          400: '#fb923c',
          500: '#f97316',
        },
        ink: {
          900: '#0f172a',
        },
      },
      fontFamily: {
        sans: ['var(--font-raleway)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(to right, #f97316, #f59e0b)',
      },
    },
  },
  plugins: [],
}

export default config
