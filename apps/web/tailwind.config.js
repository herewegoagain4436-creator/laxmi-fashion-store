/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"DM Sans"',
          '"Segoe UI"',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
      },
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
        cream: {
          DEFAULT: '#FAF7F2',
          50: '#FDFCFA',
          100: '#FAF7F2',
          200: '#F3EDE3',
        },
        surface: {
          DEFAULT: '#FFFcf8',
          muted: '#F7F2EB',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(42, 6, 17, 0.04), 0 8px 24px rgba(92, 14, 37, 0.06)',
        card: '0 1px 3px rgba(42, 6, 17, 0.05), 0 10px 28px rgba(92, 14, 37, 0.07)',
        pos: '0 8px 30px rgba(92, 14, 37, 0.12)',
        lift: '0 12px 40px rgba(92, 14, 37, 0.14)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
    },
  },
  plugins: [],
}
