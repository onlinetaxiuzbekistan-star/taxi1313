import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Ported from web taxi-app/src/stores/settings.ts, adapted to AsyncStorage.
const STORAGE_KEY = "buxtaxi_settings";

export type Theme = "light" | "dark" | "auto";
export type Language = "ru" | "uz";
export type FontSize = "small" | "medium" | "large";

const VALID_LANGUAGES: Language[] = ["ru", "uz"];
const VALID_FONTS: FontSize[] = ["small", "medium", "large"];
const FONT_SCALE: Record<FontSize, number> = { small: 0.9, medium: 1, large: 1.18 };

export function fontScaleOf(size: FontSize): number {
  return FONT_SCALE[size] ?? 1;
}

export interface AppSettings {
  theme: Theme;
  language: Language;
  fontSize: FontSize;
  soundsEnabled: boolean;
}

interface SettingsStore extends AppSettings {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (language: Language) => void;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: FontSize) => void;
  setSoundsEnabled: (enabled: boolean) => void;
  toggleLanguage: () => void;
}

const defaults: AppSettings = {
  theme: "dark",
  language: "ru",
  fontSize: "medium",
  soundsEnabled: true,
};

function persist(state: AppSettings) {
  const { theme, language, fontSize, soundsEnabled } = state;
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, language, fontSize, soundsEnabled })).catch(() => {});
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...defaults,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const next: Partial<AppSettings> = {};
        if (VALID_LANGUAGES.includes(parsed?.language)) next.language = parsed.language;
        if (["light", "dark", "auto"].includes(parsed?.theme)) next.theme = parsed.theme;
        if (VALID_FONTS.includes(parsed?.fontSize)) next.fontSize = parsed.fontSize;
        if (typeof parsed?.soundsEnabled === "boolean") next.soundsEnabled = parsed.soundsEnabled;
        set(next);
      }
    } catch {}
    set({ hydrated: true });
  },

  setLanguage: (language) => {
    set({ language });
    persist({ ...get(), language });
  },

  setTheme: (theme) => {
    set({ theme });
    persist({ ...get(), theme });
  },

  setFontSize: (fontSize) => {
    set({ fontSize });
    persist({ ...get(), fontSize });
  },

  setSoundsEnabled: (soundsEnabled) => {
    set({ soundsEnabled });
    persist({ ...get(), soundsEnabled });
  },

  toggleLanguage: () => {
    const language: Language = get().language === "ru" ? "uz" : "ru";
    set({ language });
    persist({ ...get(), language });
  },
}));
