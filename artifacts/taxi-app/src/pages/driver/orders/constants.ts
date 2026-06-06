export const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export const BAGGAGE_LABELS: Record<string, string> = {
  none: "Без багажа",
  small: "Малый багаж",
  large: "Крупный багаж",
};
