import { useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator } from "react-native";
import { User, X } from "lucide-react-native";

import { colors } from "@/lib/theme";

// RN port of web ManualClientForm: driver manually books an empty seat by
// choosing gender (Муж/Жен) and an optional phone, then POST /manual-client.
export function ManualClientForm({
  seatNumber,
  onClose,
  onSubmit,
  loading,
}: {
  seatNumber: number;
  onClose: () => void;
  onSubmit: (seatNumber: number, gender: string, phone: string) => void;
  loading?: boolean;
}) {
  const [phone, setPhone] = useState("");

  const submit = (gender: string) => {
    onSubmit(seatNumber, gender, phone.trim());
    onClose();
  };

  return (
    <View className="bg-card rounded-2xl border border-border overflow-hidden">
      <View className="bg-zinc-900 px-3 py-2.5 flex-row items-center justify-between">
        <Text className="font-sans-bold text-white text-sm">Добавить — место {seatNumber}</Text>
        <Pressable onPress={onClose} className="w-7 h-7 rounded-lg bg-white/15 items-center justify-center active:opacity-80">
          <X size={14} color="#fff" />
        </Pressable>
      </View>
      <View className="p-3" style={{ gap: 8 }}>
        <View className="flex-row" style={{ gap: 8 }}>
          {[
            { g: "male", label: "Муж" },
            { g: "female", label: "Жен" },
          ].map((b) => (
            <Pressable
              key={b.g}
              onPress={() => submit(b.g)}
              disabled={loading}
              className="flex-1 py-3 rounded-xl bg-muted border border-border flex-row items-center justify-center active:opacity-80"
              style={{ gap: 6, opacity: loading ? 0.5 : 1 }}
            >
              {loading ? <ActivityIndicator size="small" color={colors.foreground} /> : <User size={18} color={colors.foreground} />}
              <Text className="font-sans-bold text-foreground text-sm">{b.label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="Телефон (необязательно)"
          placeholderTextColor={colors.mutedForeground}
          keyboardType="phone-pad"
          className="px-3 py-2.5 rounded-lg bg-muted border border-border text-foreground text-sm"
          style={{ color: colors.foreground }}
        />
      </View>
    </View>
  );
}
