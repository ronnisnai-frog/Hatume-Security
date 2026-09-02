import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0C0E",
        surface: "#14161A",
        surfaceRaised: "#191C21",
        border: "#24272C",
        text: {
          primary: "#EDEFF2",
          secondary: "#868C96",
          muted: "#565B63",
        },
        accent: "#F2762E",
        success: "#33B579",
        warning: "#E0A63A",
        danger: "#E1484C",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
