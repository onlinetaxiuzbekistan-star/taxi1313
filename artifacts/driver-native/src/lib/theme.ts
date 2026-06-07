// Raw color values mirroring the Tailwind tokens (global.css). Use these where a
// className can't reach — e.g. lucide icon `color`/`fill` props, shadow colors,
// StatusBar. Kept in sync with global.css :root by hand.
//
// Driver palette (cyan). HSL written comma-separated for React Native's parser.
export const colors = {
  background: "hsl(240, 48%, 7%)",
  card: "hsl(240, 30%, 12%)",
  foreground: "hsl(220, 15%, 90%)",
  primary: "hsl(189, 74%, 48%)", // #1FBAD6
  primaryForeground: "hsl(0, 0%, 100%)",
  secondary: "hsl(240, 20%, 17%)",
  muted: "hsl(240, 20%, 17%)",
  mutedForeground: "hsl(240, 5%, 60%)",
  border: "hsl(240, 18%, 20%)",
  destructive: "hsl(0, 84%, 60%)",

  // Semantic accents used directly in the shell (Tailwind defaults).
  emerald: "#10b981",
  emeraldBorder: "#059669",
  amber: "#f59e0b",
  amberBorder: "#d97706",
  red: "#ef4444",
  red400: "#f87171",
  white: "#ffffff",
} as const;

export type AppColors = typeof colors;
