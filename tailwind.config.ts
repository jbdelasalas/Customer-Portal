import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff', 100: '#d9eaff', 200: '#bcdaff', 300: '#8ec2ff',
          400: '#589fff', 500: '#2f7cf6', 600: '#1a5edb', 700: '#164bb0',
          800: '#173f8b', 900: '#18376e',
        },
      },
    },
  },
  plugins: [],
};

export default config;
