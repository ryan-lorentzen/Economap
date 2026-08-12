import type { Config } from "tailwindcss";

const config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        primary: {
          DEFAULT: "#90EE90", // Light Green
          dark: "#43A047", // Slightly darker green for hover
          foreground: "#333333",
        },
        secondary: {
          DEFAULT: "#2196F3", // Blue
          dark: "#1976D2", // Slightly darker blue for hover
          foreground: "#FFFFFF",
        },
        accent: {
          DEFAULT: "#FFC107", // Yellow
          foreground: "#333333",
        },
        // Neutral colors
        background: "#F5F5F5", // Light Gray
        foreground: "#333333", // Dark Gray
        border: "#E0E0E0", // Lighter Gray for borders
      },
      fontFamily: {
        sans: ["Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;

export default config;
