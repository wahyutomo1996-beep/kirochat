/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    /*
     * Custom breakpoints tuned for 2022-2024 phone landscape:
     *   xs    280px  Galaxy Fold cover screen (folded)
     *   sm    360px  Standard small phones (Pixel 6a, iPhone SE)
     *   md    430px  Larger phones (iPhone 15 Pro Max, Galaxy S24 Ultra)
     *   fold  600px  Foldable INNER screen unfolded (Z Fold 5: 720x880)
     *   lg   1024px  Tablets, foldable in tablet mode, small laptops
     *   xl   1280px  Standard laptop
     *   2xl  1536px  Desktop
     *
     * Tailwind's default md=768 doesn't capture the "narrow but big" reality
     * of tall modern phones. We override with values that match real devices.
     */
    screens: {
      xs: '280px',
      sm: '360px',
      md: '430px',
      fold: '600px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      fontFamily: {
        // Inter is the closest open-source substitute for Linear Display/Text
        // (per DESIGN.md: "Inter at weight 500/600/700 is the closest free
        // substitute"). Fallbacks mirror Linear's stack.
        sans: ['Inter', 'SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        // Linear's signature: aggressive negative tracking on display sizes
        'display-xl': '-0.0375em',  // -3.0px at 80px
        'display-lg': '-0.032em',   // -1.8px at 56px
        'display-md': '-0.025em',   // -1.0px at 40px
        'headline':   '-0.021em',   // -0.6px at 28px
        'card-title': '-0.018em',   // -0.4px at 22px
        'subhead':    '-0.01em',    // -0.2px at 20px
        'body-lg':    '-0.0055em',  // -0.1px at 18px
        'eyebrow':    '0.031em',    // +0.4px at 13px (positive — taxonomy contrast)
      },
      colors: {
        /*
         * Linear DESIGN.md palette. Token names follow Linear's spec
         * (canvas, surface-1..4, ink, hairline, accent) but we KEEP the
         * existing Tailwind keys (surface, edge, txt, brand) so all
         * existing components still compile. They now point to Linear hex.
         */

        // Canonical Linear tokens (use these in NEW components)
        canvas: '#010102',           // deepest dark — page bg
        ink: {
          DEFAULT: '#f7f8f8',        // headlines, emphasized body (contrast 17.5)
          muted:   '#d0d6e0',        // secondary type (contrast 12.6)
          subtle:  '#8a8f98',        // tertiary type (contrast 5.6)
          tertiary:'#62666d',        // disabled, footnotes (contrast 3.4 — captions only)
        },
        hairline: {
          DEFAULT: '#23252a',        // 1px borders on cards
          strong:  '#34343a',        // input focus rings
          tertiary:'#3e3e44',        // tertiary borders, nested surfaces
        },
        accent: {
          DEFAULT: '#5e6ad2',        // Linear lavender — primary CTA, brand mark, focus
          hover:   '#828fff',        // lighter lavender (button hover)
          focus:   '#5e69d1',        // focus-ring tint
          secure:  '#7a7fad',        // muted lavender-gray (security surfaces)
        },
        success: '#27a644',          // semantic success — only chromatic besides accent

        // Legacy aliases — keep so existing UI keeps compiling, point to Linear values
        surface: {
          0: '#010102',  // canvas
          1: '#0f1011',  // surface-1 — feature/pricing cards
          2: '#141516',  // surface-2 — featured/hovered cards
          3: '#18191a',  // surface-3 — sub-nav, dropdowns
          4: '#191a1b',  // surface-4 — deepest lifted
        },
        edge: {
          DEFAULT: '#23252a',  // hairline
          subtle:  '#1a1c20',  // softer hairline (between hairline & surface-1)
          hover:   '#34343a',  // hairline-strong
          strong:  '#3e3e44',  // hairline-tertiary
        },
        txt: {
          DEFAULT:   '#f7f8f8',  // ink
          secondary: '#d0d6e0',  // ink-muted
          muted:     '#8a8f98',  // ink-subtle
          faint:     '#62666d',  // ink-tertiary
          ghost:     '#4a4d52',  // dim placeholder
        },
        brand: {
          DEFAULT: '#5e6ad2',  // Linear lavender as primary (was: white)
          dim:     '#828fff',  // lighter hover
          ink:     '#ffffff',  // text on brand bg
        },
      },
      // Linear's surface ladder doesn't lean on shadows — lift = surface change
      // + 1px hairline. Shadow tokens here are the only "depth" sanctioned.
      boxShadow: {
        'lift-1': '0 0 0 1px #23252a',
        'lift-2': '0 0 0 1px #34343a, 0 1px 0 rgba(255,255,255,0.04) inset',
        'focus':  '0 0 0 2px rgba(94, 105, 210, 0.5)',
        'accent': '0 4px 24px -4px rgba(94, 105, 210, 0.45)',
      },
    },
  },
  plugins: [],
};
