/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          black: '#02040a',
          darker: '#0d1117',
          dark: '#161b22',
          accent: 'rgb(var(--theme-accent-rgb) / <alpha-value>)',
          text: {
            primary: '#ffffff',
            secondary: '#7d8590',
          },
          surface: '#0d1117',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
        hack: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
