import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";

import { colors } from "@/lib/theme";

const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

// Lightweight month-grid date picker (no native dependency).
export function Calendar({ value, onSelect }: { value: Date | null; onSelect: (d: Date) => void }) {
  const [view, setView] = useState(() => {
    const d = value || new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = view.getFullYear();
  const month = view.getMonth();
  const startWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Mon = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isSel = (d: number) =>
    !!value && value.getFullYear() === year && value.getMonth() === month && value.getDate() === d;
  const isToday = (d: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;

  return (
    <View className="bg-card border border-border rounded-2xl p-3">
      <View className="flex-row items-center justify-between mb-2">
        <Pressable onPress={() => setView(new Date(year, month - 1, 1))} className="w-9 h-9 items-center justify-center active:opacity-70">
          <ChevronLeft size={20} color={colors.foreground} />
        </Pressable>
        <Text className="font-sans-bold text-foreground text-sm">{MONTHS[month]} {year}</Text>
        <Pressable onPress={() => setView(new Date(year, month + 1, 1))} className="w-9 h-9 items-center justify-center active:opacity-70">
          <ChevronRight size={20} color={colors.foreground} />
        </Pressable>
      </View>
      <View className="flex-row">
        {WD.map((w) => (
          <View key={w} className="flex-1 items-center">
            <Text className="font-sans text-muted-foreground text-[11px]">{w}</Text>
          </View>
        ))}
      </View>
      <View className="flex-row flex-wrap mt-1">
        {cells.map((d, i) => (
          <View key={i} style={{ width: `${100 / 7}%` }} className="items-center py-0.5">
            {d ? (
              <Pressable
                onPress={() => onSelect(new Date(year, month, d))}
                className={`w-9 h-9 rounded-full items-center justify-center ${isSel(d) ? "bg-primary" : ""}`}
              >
                <Text
                  className={`font-sans-semibold text-[13px] ${
                    isSel(d) ? "text-primary-foreground" : isToday(d) ? "text-primary" : "text-foreground"
                  }`}
                >
                  {d}
                </Text>
              </Pressable>
            ) : (
              <View className="w-9 h-9" />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
