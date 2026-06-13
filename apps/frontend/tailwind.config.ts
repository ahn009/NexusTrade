// apps/frontend/tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: '#f5f6f8',
        panel: '#ffffff',
        soft: '#f0f2f5',
        chart: '#fafafa',
        ink: '#181a20',
        foreground: '#1e2329',
        muted: '#707a8a',
        line: '#e5e7eb',
        accent: '#f0b90b',
        warning: '#c99400',
        positive: '#0ecb81',
        danger: '#f6465d'
      }
    }
  },
  plugins: []
};

export default config;
