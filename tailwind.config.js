/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // Background layers - dari paling gelap ke paling terang
        surface: {
          0: '#0d0d0d',  // base background
          1: '#161616',  // elevated card
          2: '#1f1f1f',  // hover state
          3: '#2a2a2a',  // active/selected
          4: '#363636',  // strong elevation
        },
        // Borders - semua pake nilai yang lebih terang
        edge: {
          DEFAULT: '#333333',
          subtle: '#262626',
          hover: '#4a4a4a',
          strong: '#5c5c5c',
        },
        // Text - semua high contrast, minimum 4.5:1
        txt: {
          DEFAULT: '#ffffff',     // contrast 18.0 - PRIMARY
          secondary: '#e5e5e5',   // contrast 14.5 - SUBTITLE
          muted: '#b8b8b8',       // contrast 9.0 - LABEL
          faint: '#9a9a9a',       // contrast 6.5 - HELPER
          ghost: '#7a7a7a',       // contrast 4.6 - PLACEHOLDER (minimum)
        },
        // Brand
        brand: {
          DEFAULT: '#ffffff',
          dim: '#d4d4d4',
        },
      },
    },
  },
  plugins: [],
};
