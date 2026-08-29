import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Tokens mirror the Sarvam design system: an 8px base grid, the documented
 * radius roles, and the type scale with its exact weights (425/525/625 are
 * variable-font weights, which is why the UI face must be a variable font).
 */
export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: "16px", sm: "24px", lg: "32px" },
      screens: { "2xl": "1200px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-ui)"],
        display: ["var(--font-display)"],
      },
      fontSize: {
        // role: [size, { lineHeight, letterSpacing, fontWeight }]
        display: ["clamp(40px, 11vw, 64px)", { lineHeight: "1.1", letterSpacing: "-0.5px" }],
        section: ["clamp(28px, 6vw, 36px)", { lineHeight: "1.2", letterSpacing: "-0.72px" }],
        subheading: ["20px", { lineHeight: "26px", letterSpacing: "-0.3px" }],
        body: ["16px", { lineHeight: "24px" }],
        label: ["14px", { lineHeight: "20px" }],
        caption: ["12px", { lineHeight: "18.6px" }],
        button: ["15px", { lineHeight: "22.5px" }],
        eyebrow: ["12px", { lineHeight: "16px", letterSpacing: "0.05em" }],
      },
      fontWeight: {
        regular: "425",
        medium: "525",
        semibold: "625",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        brand: {
          purple: "hsl(var(--brand-purple))",
          indigo: "hsl(var(--brand-indigo))",
          orange: "hsl(var(--brand-orange))",
        },
        text: {
          primary: "hsl(var(--text-primary))",
          secondary: "hsl(var(--text-secondary))",
          tertiary: "hsl(var(--text-tertiary))",
        },
      },
      spacing: {
        // The documented 8px-base scale, available as p-2 / gap-14 / etc.
        "0.5": "2px",
        "1": "4px",
        "1.5": "6px",
        "2": "8px",
        "2.5": "10px",
        "3": "12px",
        "3.5": "14px",
        "4": "16px",
        "4.5": "18px",
        "5": "20px",
        "6": "24px",
        "7": "28px",
        "8": "32px",
        "10": "40px",
        "12": "48px",
        "14": "56px",
        "15": "60px",
        "16": "64px",
        "40": "160px",
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
        card: "12px",
        panel: "16px",
        "2xl": "16px",
        badge: "20px",
        chip: "24px",
        "4xl": "32px",
        pill: "9999px",
      },
      boxShadow: {
        // The system records no drop-shadow evidence, so elevation stays flat;
        // these are hairlines and the CTA's inset depth only.
        hairline: "0 0 0 1px hsl(var(--border-subtle))",
        sheet: "0 -8px 32px -12px hsl(0 0% 0% / 0.18)",
        lift: "0 8px 30px -12px hsl(0 0% 0% / 0.16)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
        "slide-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        /**
         * Centred dialogs are positioned with left/top 50% plus a -50%
         * translate. An animation that sets `transform` would override that
         * translate (fill-mode: both) and drop the panel's corner on the
         * centre point, so the centring is baked into these keyframes.
         */
        "dialog-in": {
          from: { opacity: "0", transform: "translate(-50%, -50%) scale(0.96)" },
          to: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        "dialog-out": {
          from: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
          to: { opacity: "0", transform: "translate(-50%, -50%) scale(0.97)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.24s ease-out both",
        "slide-up": "slide-up 0.26s cubic-bezier(0.32, 0.72, 0, 1) both",
        "scale-in": "scale-in 0.2s ease-out both",
        "dialog-in": "dialog-in 0.2s ease-out both",
        "dialog-out": "dialog-out 0.15s ease-in both",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
