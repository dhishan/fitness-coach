/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        muscle: {
          chest: '#ef4444',
          back: '#3b82f6',
          quads: '#f97316',
          hamstrings: '#f59e0b',
          glutes: '#ec4899',
          shoulders: '#8b5cf6',
          biceps: '#06b6d4',
          triceps: '#14b8a6',
          core: '#84cc16',
          calves: '#6366f1',
          forearms: '#6b7280',
        },
      },
    },
  },
  plugins: [],
}

