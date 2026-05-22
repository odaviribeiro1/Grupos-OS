import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0A0A0F",
          card: "rgba(15, 23, 42, 0.6)",
        },
        brand: {
          50: "#EFF6FF",
          400: "#60A5FA",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
          900: "#1E3A8A",
        },
        ink: {
          50: "#F8FAFC",
          200: "#CBD5E1",
          400: "#94A3B8",
        },
        success: "#10B981",
        danger: "#EF4444",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "16px",
      },
      backgroundImage: {
        "brand-gradient":
          "linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%)",
        "brand-gradient-hover":
          "linear-gradient(135deg, #1E40AF 0%, #60A5FA 100%)",
      },
      boxShadow: {
        "glow-sm": "0 0 30px rgba(59, 130, 246, 0.25)",
        "glow-md": "0 0 60px rgba(59, 130, 246, 0.35)",
        "inset-top":
          "inset 0 1px 0 0 rgba(255, 255, 255, 0.06)",
      },
      transitionTimingFunction: {
        glow: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
