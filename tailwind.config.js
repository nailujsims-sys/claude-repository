/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Design tokens — see DESIGN SYSTEM in README / spec.
        'bg-base': '#080C14',
        'bg-card': '#0F1629',
        'bg-elevated': '#141E35',
        'bg-input': '#1A2340',
        accent: '#4A80FF',
        'accent-dim': '#1E3A6E',
        'text-primary': '#FFFFFF',
        'text-secondary': '#8891A4',
        'text-muted': '#4A5268',
        danger: '#EF4444',
        success: '#34D399',
        'section-label': '#4A5268',
      },
      borderColor: {
        subtle: 'rgba(255, 255, 255, 0.06)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"Segoe UI"',
          'sans-serif',
        ],
      },
      // Type scale (G10). These are the sizes the app already used as inline
      // literals; naming them is the whole change — every value is unchanged.
      //
      // Deliberately font-size ONLY (string form, not the [size, {...}] tuple):
      // line-height stays inherited from Tailwind's preflight (1.5) plus the
      // handful of local `leading-*` overrides, exactly as before. Adding
      // per-step line-heights here would move 72–99% of all elements — that is
      // a design decision, not a token migration.
      //
      // Two names share 16px on purpose: they are two different roles that
      // happen to have the same size today, and the design system asks us to
      // name roles, not pixels.
      fontSize: {
        title: '28px', // screen title (h1)
        'section-title': '18px', // heading of a section inside a screen
        'panel-title': '17px', // title of a sheet, dialog or the sidebar
        'card-title': '16px', // heading of a card
        field: '16px', // a form's primary text field
        body: '15px', // default text and controls
        'body-sm': '14px', // quieter body text, compact controls
        label: '13px', // form labels, chips, hints, inline errors
        meta: '12px', // metadata next to primary content
        caption: '11px', // tab labels, weekday headers, section labels
        micro: '10px', // micro labels in the calendar grid
      },
      borderRadius: {
        card: '16px',
        btn: '12px',
        input: '12px',
        chip: '8px',
      },
      maxWidth: {
        app: '430px',
      },
      keyframes: {
        'sheet-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'star-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.3)' },
          '100%': { transform: 'scale(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'sheet-up': 'sheet-up 300ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 200ms ease-out',
        'slide-in-left': 'slide-in-left 250ms cubic-bezier(0.16, 1, 0.3, 1)',
        'star-pop': 'star-pop 200ms ease-out',
        'toast-in': 'toast-in 200ms ease-out',
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
}
