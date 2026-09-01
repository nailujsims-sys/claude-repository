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
      // Typography scale (§15, G10) — the sizes the product already speaks,
      // named by the roles §15 asks for, so a new module picks a token instead
      // of inventing a value. Size only, deliberately: `text-[15px]` sets
      // nothing but `font-size`, so a token that also carried a line-height
      // would not be a drop-in for the literal it replaces. Weight, leading and
      // tracking stay explicit utilities at the call site.
      //
      // Existing `text-[Npx]` literals are migrated only when their line is
      // touched anyway (see known-gaps.md → G10); a handful of one-off sizes
      // stay off the scale until then.
      fontSize: {
        page: '28px', // screen titles — Home, Aufgaben, Mehr, Version
        section: '18px', // section titles inside a screen
        heading: '17px', // the title of a surface: sheet, dialog, sidebar
        field: '16px', // form fields — 16px is also what stops iOS zooming on focus
        body: '15px', // default body and list text
        ui: '14px', // controls: buttons, toast, chips
        label: '13px', // labels and section labels
        caption: '12px', // secondary and meta lines under a title
        meta: '11px', // the smallest step: badges, calendar day numbers
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
        // What enters from the top leaves toward the top (§11). Shorter and
        // ease-in, so the toast gets out of the way faster than it arrived.
        'toast-out': {
          from: { opacity: '1', transform: 'translateY(0)' },
          to: { opacity: '0', transform: 'translateY(-12px)' },
        },
        // The task-detail menu (G15). It belongs to the button it hangs from,
        // so it grows out of that corner (§11) instead of sliding in from
        // somewhere — `origin-top-right` at the call site does the anchoring.
        'menu-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'menu-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.95)' },
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
        // 180ms is TOAST_EXIT_MS in src/context/ToastContext.jsx, which is what
        // keeps the card in the DOM until this has run. `both` holds the last
        // frame, so the toast stays gone instead of flashing back before it is
        // removed.
        'toast-out': 'toast-out 180ms ease-in both',
        // 120ms is MENU_EXIT_MS in src/screens/TaskDetail.jsx, which keeps the
        // menu mounted until this has run. A popover is small and close to the
        // finger, so it is quicker than a sheet or a toast.
        'menu-in': 'menu-in 120ms ease-out',
        'menu-out': 'menu-out 120ms ease-in both',
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
}
