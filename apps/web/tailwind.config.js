/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#FDF6F7',
          100: '#F8E8EB',
          200: '#E8C5CC',
          300: '#D194A0',
          400: '#B54A62',
          500: '#8B1538',
          600: '#7A1230',
          700: '#5C0E25',
          800: '#3D0919',
          900: '#2A0611',
        },
        gold: {
          400: '#D4AF37',
          500: '#C9A227',
          600: '#A68520',
        },
        cream: '#FAF7F2',
      },
      boxShadow: {
        pos: '0 8px 30px rgba(92, 14, 37, 0.12)',
      },
    },
  },
  plugins: [],
}
