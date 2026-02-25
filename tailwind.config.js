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
          accent: '#e8117a', // Magenta/Pink from image
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
