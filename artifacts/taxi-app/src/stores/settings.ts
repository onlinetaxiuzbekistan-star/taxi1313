import { create } from "zustand";

const STORAGE_KEY = "buxtaxi_settings";

export type Theme = "light" | "dark" | "auto";
export type Language = "ru" | "uz";
export type FontSize = "small" | "normal" | "large";

const VALID_THEMES: Theme[] = ["light", "dark", "auto"];
const VALID_LANGUAGES: Language[] = ["ru", "uz"];
const VALID_FONT_SIZES: FontSize[] = ["small", "normal", "large"];

const FONT_SIZE_PX: Record<FontSize, number> = {
  small: 15,
  normal: 17,
  large: 20,
};

export interface AppSettings {
  theme: Theme;
  language: Language;
  fontSize: FontSize;
  fontScale: number;
  sound: string;
  notificationsEnabled: boolean;
  roofBaggage: boolean;
  childSeat: boolean;
  acceptParcels: boolean;
}

interface SettingsStore extends AppSettings {
  setTheme: (theme: Theme) => void;
  setLanguage: (language: Language) => void;
  setFontSize: (size: FontSize) => void;
  setFontScale: (scale: number) => void;
  increaseFontScale: () => void;
  decreaseFontScale: () => void;
  setSound: (sound: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setRoofBaggage: (v: boolean) => void;
  setChildSeat: (v: boolean) => void;
  setAcceptParcels: (v: boolean) => void;
}

function isValidTheme(v: unknown): v is Theme {
  return typeof v === "string" && VALID_THEMES.includes(v as Theme);
}

function isValidLanguage(v: unknown): v is Language {
  return typeof v === "string" && VALID_LANGUAGES.includes(v as Language);
}

function isValidFontSize(v: unknown): v is FontSize {
  return typeof v === "string" && VALID_FONT_SIZES.includes(v as FontSize);
}

function validate(raw: Record<string, unknown>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (isValidTheme(raw.theme)) result.theme = raw.theme;
  if (isValidLanguage(raw.language)) result.language = raw.language;
  if (raw.language === "en") result.language = "ru";
  if (isValidFontSize(raw.fontSize)) result.fontSize = raw.fontSize;
  if (typeof raw.fontScale === "number" && raw.fontScale >= 0.5 && raw.fontScale <= 2.0) {
    result.fontScale = raw.fontScale;
  }
  if (typeof raw.sound === "string" && raw.sound.length > 0) result.sound = raw.sound;
  if (typeof raw.notificationsEnabled === "boolean") result.notificationsEnabled = raw.notificationsEnabled;
  if (typeof raw.roofBaggage === "boolean") result.roofBaggage = raw.roofBaggage;
  if (typeof raw.childSeat === "boolean") result.childSeat = raw.childSeat;
  if (typeof raw.acceptParcels === "boolean") result.acceptParcels = raw.acceptParcels;
  return result;
}

function loadFromStorage(): Partial<AppSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return validate(parsed);
    }
  } catch {}

  const legacy: Partial<AppSettings> = {};
  const lang = localStorage.getItem("buxtaxi_lang");
  if (isValidLanguage(lang)) legacy.language = lang;
  const theme = localStorage.getItem("buxtaxi_theme");
  if (isValidTheme(theme)) legacy.theme = theme;
  return legacy;
}

function persist(state: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem("buxtaxi_lang", state.language);
    localStorage.setItem("buxtaxi_theme", state.theme);
  } catch {}
  syncToServer(state);
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
function syncToServer(state: AppSettings) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const token = localStorage.getItem("buxtaxi_token") || sessionStorage.getItem("buxtaxi_token");
      if (!token) return;
      const base = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL || "/").replace(/\/$/, "");
      await fetch(`${base}/api/auth/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(state),
      });
    } catch {}
  }, 2000);
}

export async function loadPreferencesFromServer(): Promise<void> {
  try {
    const token = localStorage.getItem("buxtaxi_token") || sessionStorage.getItem("buxtaxi_token");
    if (!token) return;
    const base = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL || "/").replace(/\/$/, "");
    const res = await fetch(`${base}/api/auth/preferences`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.preferences && typeof data.preferences === "object" && Object.keys(data.preferences).length > 0) {
      const validated = validate(data.preferences as Record<string, unknown>);
      if (Object.keys(validated).length > 0) {
        const store = useSettingsStore.getState();
        const merged = { ...store, ...validated };
        useSettingsStore.setState(validated);
        applySettings(merged);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
      }
    }
  } catch {}
}

const defaults: AppSettings = {
  theme: "dark",
  language: "ru",
  fontSize: "normal",
  fontScale: 1.0,
  sound: "default",
  notificationsEnabled: true,
  roofBaggage: false,
  childSeat: false,
  acceptParcels: false,
};

function migrateLegacyDriverOptions(): Partial<AppSettings> {
  const out: Partial<AppSettings> = {};
  try {
    const rb = localStorage.getItem("buxtaxi_roofBaggage");
    if (rb === "true" || rb === "false") out.roofBaggage = rb === "true";
    const cs = localStorage.getItem("buxtaxi_childSeat");
    if (cs === "true" || cs === "false") out.childSeat = cs === "true";
    const ap = localStorage.getItem("buxtaxi_acceptParcels");
    if (ap === "true" || ap === "false") out.acceptParcels = ap === "true";
  } catch {}
  return out;
}

const initial: AppSettings = { ...defaults, ...migrateLegacyDriverOptions(), ...loadFromStorage() };

function resolveEffectiveTheme(theme: Theme): "light" | "dark" {
  if (theme === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function forceTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

export function applySettings(settings: AppSettings) {
  const root = document.documentElement;
  const effective = resolveEffectiveTheme(settings.theme);
  root.setAttribute("data-theme", effective);
  root.classList.toggle("dark", effective === "dark");
  root.classList.toggle("light", effective === "light");
  const basePx = FONT_SIZE_PX[settings.fontSize] || 16;
  const scaledPx = Math.round(basePx * (settings.fontScale || 1.0));
  root.style.fontSize = `${scaledPx}px`;
  root.setAttribute("lang", settings.language === "uz" ? "uz" : "ru");
  console.log("THEME:", effective, "FONT:", settings.fontSize, "LANG:", settings.language);
}

applySettings(initial);

try {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const current = useSettingsStore.getState();
    if (current.theme === "auto") applySettings(current);
  });
} catch {}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...initial,

  setTheme: (theme) => {
    set({ theme });
    const s = { ...get(), theme };
    applySettings(s);
    persist(s);
  },

  setLanguage: (language) => {
    set({ language });
    const s = { ...get(), language };
    applySettings(s);
    persist(s);
  },

  setFontSize: (fontSize) => {
    set({ fontSize });
    const s = { ...get(), fontSize };
    applySettings(s);
    persist(s);
  },

  setFontScale: (fontScale) => {
    const clamped = Math.max(0.5, Math.min(2.0, fontScale));
    set({ fontScale: clamped });
    const s = { ...get(), fontScale: clamped };
    applySettings(s);
    persist(s);
  },

  increaseFontScale: () => {
    const current = get().fontScale || 1.0;
    const next = Math.min(2.0, Math.round((current + 0.1) * 10) / 10);
    set({ fontScale: next });
    const s = { ...get(), fontScale: next };
    applySettings(s);
    persist(s);
  },

  decreaseFontScale: () => {
    const current = get().fontScale || 1.0;
    const next = Math.max(0.5, Math.round((current - 0.1) * 10) / 10);
    set({ fontScale: next });
    const s = { ...get(), fontScale: next };
    applySettings(s);
    persist(s);
  },

  setSound: (sound) => {
    set({ sound });
    persist({ ...get(), sound });
  },

  setNotificationsEnabled: (notificationsEnabled) => {
    set({ notificationsEnabled });
    persist({ ...get(), notificationsEnabled });
  },

  setRoofBaggage: (roofBaggage) => {
    set({ roofBaggage });
    persist({ ...get(), roofBaggage });
  },

  setChildSeat: (childSeat) => {
    set({ childSeat });
    persist({ ...get(), childSeat });
  },

  setAcceptParcels: (acceptParcels) => {
    set({ acceptParcels });
    persist({ ...get(), acceptParcels });
  },
}));
