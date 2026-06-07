import type { DriverUser } from "@/types";
import { API_BASE_URL } from "@/config";

// Callsign logic ported verbatim from web DriverLayout.tsx.
const CITY_PREFIX: Record<string, string> = {
  Ташкент: "TAS",
  Самарканд: "SAM",
  Бухара: "BUX",
  Фергана: "FER",
  Андижан: "AND",
  Наманган: "NAM",
  Нукус: "NUK",
  Карши: "KAR",
  Навои: "NAV",
  Термез: "TER",
  Гулистан: "GUL",
  Джиззак: "JIZ",
  Ургенч: "URG",
};

export function getCallsign(user: Pick<DriverUser, "id" | "city"> | null | undefined): string {
  const pfx = user?.city ? CITY_PREFIX[user.city] || "BT" : "BT";
  return `${pfx}-${String(user?.id || 0).padStart(3, "0")}`;
}

export function getPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${clean}`;
}

// Demo driver used only for the Phase 0 design preview (see config.PREVIEW_MODE),
// so the shell renders fully without a live login. Never used once authenticated.
export const DEMO_DRIVER: DriverUser = {
  id: 1,
  phone: "+998901234567",
  name: "Алишер Усмонов",
  role: "driver" as DriverUser["role"],
  status: "online",
  city: "Бухара",
  balance: 152000,
  carModel: "Chevrolet Cobalt",
  carNumber: "30 A 123 BC",
  rating: 4.9,
  bannedUntil: null,
  driverPhoto: null,
};
