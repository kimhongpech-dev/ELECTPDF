/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: {
          bg: '#0b1220',
          panel: '#111827',
          border: '#1f2937',
          primary: '#3b82f6',
          muted: '#94a3b8',
          success: '#22c55e',
          warning: '#f59e0b',
          error: '#ef4444',
        },
      },
      boxShadow: {
        soft: '0 8px 32px rgba(15, 23, 42, 0.16)',
      },
    },
  },
  plugins: [],
}
