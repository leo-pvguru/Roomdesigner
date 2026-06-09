/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        royal: { DEFAULT: '#1A4FBF', 700: '#143F99' },
        electric: { DEFAULT: '#2E87F5', 700: '#1E6FD9' },
        amber: { gold: '#F5A623', 700: '#D88B0F' },
        ink: { DEFAULT: '#12151A', card: '#1E2530' },
      },
      fontFamily: {
        display: ['Montserrat', 'system-ui', 'sans-serif'],
        body: ['"Open Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
