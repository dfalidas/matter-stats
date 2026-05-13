import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        paper: "#f8f3ea",
        matter: "#ff5a4f",
      },
      boxShadow: {
        soft: "0 24px 80px rgba(17, 24, 39, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
