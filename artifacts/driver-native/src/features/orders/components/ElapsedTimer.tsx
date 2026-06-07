import { useState, useEffect } from "react";
import { View, Text } from "react-native";
import { Clock } from "lucide-react-native";

import { colors } from "@/lib/theme";

// Ported from web orders/components/ElapsedTimer.tsx.
export function ElapsedTimer({ since }: { since?: string }) {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!since) return;
    const start = new Date(since).getTime();
    const tick = () => {
      const diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(h > 0 ? `${h}ч ${String(m).padStart(2, "0")}м` : `${m}м ${String(s).padStart(2, "0")}с`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return null;
  return (
    <View className="flex-row items-center" style={{ gap: 6 }}>
      <Clock size={14} color={colors.mutedForeground} />
      <Text className="font-sans text-muted-foreground text-xs">
        В пути: <Text className="font-sans-bold text-foreground">{elapsed}</Text>
      </Text>
    </View>
  );
}
