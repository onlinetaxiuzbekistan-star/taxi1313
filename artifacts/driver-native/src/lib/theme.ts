// Raw color values mirroring the Tailwind tokens (global.css). Use these where a
// className can't reach — e.g. lucide icon `color`/`fill` props, StatusBar.
//
// `colors` is a MUTABLE live object: applyThemeColors() swaps its values in
// place when the driver switches dark/light in Settings, and the app re-mounts
// (keyed on theme) so every component re-reads the current values.

export const DARK_COLORS = {
  background: "hsl(240, 48%, 7%)",
  card: "hsl(240, 30%, 12%)",
  foreground: "hsl(220, 15%, 90%)",
  primary: "hsl(0, 72%, 51%)",
  primaryForeground: "hsl(0, 0%, 100%)",
  secondary: "hsl(240, 20%, 17%)",
  muted: "hsl(240, 20%, 17%)",
  mutedForeground: "hsl(240, 5%, 60%)",
  border: "hsl(240, 18%, 20%)",
  destructive: "hsl(0, 84%, 60%)",
  emerald: "#10b981",
  emeraldBorder: "#059669",
  amber: "#f59e0b",
  amberBorder: "#d97706",
  red: "#ef4444",
  red400: "#f87171",
  white: "#ffffff",
};

export const LIGHT_COLORS: typeof DARK_COLORS = {
  background: "hsl(220, 16%, 96%)",
  card: "hsl(0, 0%, 100%)",
  foreground: "hsl(222, 22%, 14%)",
  primary: "hsl(0, 72%, 47%)",
  primaryForeground: "hsl(0, 0%, 100%)",
  secondary: "hsl(220, 14%, 91%)",
  muted: "hsl(220, 14%, 91%)",
  mutedForeground: "hsl(220, 9%, 40%)",
  border: "hsl(220, 13%, 84%)",
  destructive: "hsl(0, 78%, 50%)",
  emerald: "#059669",
  emeraldBorder: "#047857",
  amber: "#d97706",
  amberBorder: "#b45309",
  red: "#dc2626",
  red400: "#ef4444",
  white: "#ffffff",
};

// Live, mutable color object consumed throughout the app.
export const colors = { ...DARK_COLORS };

export function applyThemeColors(theme: "light" | "dark" | "auto") {
  Object.assign(colors, theme === "light" ? LIGHT_COLORS : DARK_COLORS);
}

export type AppColors = typeof colors;
