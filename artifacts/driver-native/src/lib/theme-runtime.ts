import { Text, TextInput, StyleSheet } from "react-native";
import { vars } from "nativewind";

// CSS-variable sets for the className tokens (bg-background, text-foreground…).
// Values are the HSL triplets the tailwind config reads via hsl(var(--token)).
const DARK_VARS: Record<string, string> = {
  "--background": "240 48% 7%",
  "--foreground": "220 15% 90%",
  "--card": "240 30% 12%",
  "--card-foreground": "220 15% 92%",
  "--popover": "240 30% 12%",
  "--popover-foreground": "220 15% 92%",
  "--primary": "189 74% 48%",
  "--primary-foreground": "0 0% 100%",
  "--secondary": "240 20% 17%",
  "--secondary-foreground": "220 15% 90%",
  "--muted": "240 20% 17%",
  "--muted-foreground": "240 5% 60%",
  "--accent": "189 74% 48%",
  "--accent-foreground": "0 0% 100%",
  "--destructive": "0 84% 60%",
  "--destructive-foreground": "220 15% 92%",
  "--border": "240 18% 20%",
  "--input": "240 18% 20%",
  "--ring": "189 74% 48%",
};

const LIGHT_VARS: Record<string, string> = {
  "--background": "220 16% 96%",
  "--foreground": "222 22% 14%",
  "--card": "0 0% 100%",
  "--card-foreground": "222 22% 14%",
  "--popover": "0 0% 100%",
  "--popover-foreground": "222 22% 14%",
  "--primary": "189 74% 40%",
  "--primary-foreground": "0 0% 100%",
  "--secondary": "220 14% 91%",
  "--secondary-foreground": "222 22% 14%",
  "--muted": "220 14% 91%",
  "--muted-foreground": "220 9% 40%",
  "--accent": "189 74% 40%",
  "--accent-foreground": "0 0% 100%",
  "--destructive": "0 78% 50%",
  "--destructive-foreground": "0 0% 100%",
  "--border": "220 13% 84%",
  "--input": "220 13% 84%",
  "--ring": "189 74% 40%",
};

export function themeVars(theme: "light" | "dark" | "auto") {
  try {
    return vars(theme === "light" ? LIGHT_VARS : DARK_VARS);
  } catch {
    return {};
  }
}

// ── Global font scaling ──
// Text/TextInput are forwardRef components, so `.render` is the inner render fn.
// We wrap it to multiply any explicit fontSize by the current scale. Guarded so
// a failure can never crash the app (font scaling just becomes a no-op).
let currentScale = 1;

export function setFontScale(scale: number) {
  currentScale = scale || 1;
}

let patched = false;
export function patchFontScaling() {
  if (patched) return;
  patched = true;
  try {
    for (const Comp of [Text, TextInput] as any[]) {
      const orig = Comp?.render;
      if (typeof orig !== "function" || Comp.__fontScalePatched) continue;
      Comp.__fontScalePatched = true;
      Comp.render = function patchedRender(props: any, ref: any) {
        const el = orig.call(this, props, ref);
        try {
          if (currentScale !== 1 && el && el.props) {
            const flat = StyleSheet.flatten(el.props.style) || {};
            const fs = (flat as any).fontSize;
            if (typeof fs === "number") {
              return { ...el, props: { ...el.props, style: [el.props.style, { fontSize: fs * currentScale }] } };
            }
          }
        } catch {}
        return el;
      };
    }
  } catch {}
}
