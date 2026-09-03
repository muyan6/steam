/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
        },
        steam: {
          dark: '#171a21',
          darker: '#0e141b',
          card: '#1b2838',
          cardHover: '#23354a',
          accent: '#66c0f4',
          blue: '#1999ff',
          green: '#5c7e10',
          greenHover: '#79991b'
        }
      }
    },
  },
  plugins: [],
}
