// i18n strings ported from the web driver app (inline `lang === "uz" ? … : …`
// ternaries in DriverLayout.tsx and friends), collected into a typed dictionary.
// Russian (ru) and Uzbek (uz), matching the existing copy verbatim.
import { useSettingsStore, type Language } from "@/stores/settings";

export const translations = {
  // bottom nav
  nav_orders: { ru: "Заказы", uz: "Buyurtmalar" },
  nav_urgent: { ru: "Срочные", uz: "Shoshilinch" },
  nav_chat: { ru: "Чат", uz: "Chat" },
  nav_profile: { ru: "Профиль", uz: "Profil" },

  // online/offline toggle
  status_online: { ru: "Online", uz: "Online" },
  status_offline: { ru: "Offline", uz: "Offline" },
  status_busy: { ru: "В рейсе", uz: "Reysda" },

  // header
  balance_unit: { ru: "сум", uz: "сум" },
  balance_title: { ru: "Баланс", uz: "Balans" },
  exit_app: { ru: "Закрыть приложение", uz: "Chiqish" },

  // exit confirm
  exit_q: { ru: "Закрыть приложение?", uz: "Dasturdan chiqasizmi?" },
  exit_sub: { ru: "Приложение будет закрыто", uz: "Dastur yopiladi" },
  cancel: { ru: "Отмена", uz: "Bekor qilish" },
  close: { ru: "Закрыть", uz: "Chiqish" },

  // online confirm
  go_offline_q: { ru: "Выйти с линии?", uz: "Liniyadan chiqasizmi?" },
  go_online_q: { ru: "Выйти на линию?", uz: "Liniyaga chiqasizmi?" },
  go_offline_sub: {
    ru: "Вы перестанете получать новые заказы",
    uz: "Yangi buyurtmalarni qabul qilishni to‘xtatasiz",
  },
  go_online_sub: {
    ru: "Вы начнёте получать новые заказы",
    uz: "Yangi buyurtmalarni qabul qila boshlaysiz",
  },
  go_offline_btn: { ru: "Выйти", uz: "Chiqish" },
  go_online_btn: { ru: "На линию", uz: "Chiqish" },

  // placeholder screens (Phase 0)
  orders_title: { ru: "Заказы", uz: "Buyurtmalar" },
  orders_empty: { ru: "Нет доступных заказов", uz: "Mavjud buyurtmalar yo‘q" },
  urgent_title: { ru: "Срочные заказы", uz: "Shoshilinch buyurtmalar" },
  chat_title: { ru: "Чат", uz: "Chat" },
  profile_title: { ru: "Профиль", uz: "Profil" },
  language: { ru: "Язык", uz: "Til" },
  phase0_note: {
    ru: "Экран будет перенесён в следующих фазах",
    uz: "Bu ekran keyingi bosqichlarda ko‘chiriladi",
  },
} as const;

export type TKey = keyof typeof translations;

export function t(key: TKey, lang: Language): string {
  const entry = translations[key];
  return (entry?.[lang] ?? entry?.ru ?? key) as string;
}

// Hook form: re-renders when the language changes.
export function useT() {
  const lang = useSettingsStore((s) => s.language);
  return {
    lang,
    t: (key: TKey) => t(key, lang),
  };
}
