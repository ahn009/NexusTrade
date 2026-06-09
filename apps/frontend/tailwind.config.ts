// apps/frontend/tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f7f8fa',
        foreground: '#17202a',
        muted: '#657386',
        line: '#d9e0e8',
        accent: '#0d9488',
        warning: '#b45309',
        danger: '#b91c1c'
      }
    }
  },
  plugins: []
};

export default config;
