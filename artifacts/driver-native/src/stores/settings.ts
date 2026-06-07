import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Ported from web taxi-app/src/stores/settings.ts, trimmed to what the native
// shell needs for Phase 0 (language + theme) and adapted to AsyncStorage
// (the web version uses localStorage + DOM, neither of which exists in RN).
// Server sync (PUT /api/auth/preferences) can be re-added in a later phase.

const STORAGE_KEY = "buxtaxi_settings";

export type Theme = "light" | "dark" | "auto";
export type Language = "ru" | "uz";

const VALID_LANGUAGES: Language[] = ["ru", "uz"];

export interface AppSettings {
  theme: Theme;
  language: Language;
}

interface SettingsStore extends AppSettings {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (language: Language) => void;
  setTheme: (theme: Theme) => void;
  toggleLanguage: () => void;
}

const defaults: AppSettings = {
  theme: "dark",
  language: "ru",
};

function persist(state: AppSettings) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
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

  toggleLanguage: () => {
    const language: Language = get().language === "ru" ? "uz" : "ru";
    set({ language });
    persist({ ...get(), language });
  },
}));
