import { useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator } from "react-native";
import { User, X } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";

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
  const { t } = useT();
  const [phone, setPhone] = useState("");
  const [touched, setTouched] = useState(false);

  // Phone is REQUIRED — need at least 7 digits before the client can be added.
  const digits = phone.replace(/\D/g, "");
  const phoneValid = digits.length >= 7;

  const submit = (gender: string) => {
    if (!phoneValid) {
      setTouched(true);
      return;
    }
    onSubmit(seatNumber, gender, phone.trim());
    onClose();
  };

  return (
    <View className="bg-card rounded-2xl border border-border overflow-hidden">
      <View className="bg-zinc-900 px-3 py-2.5 flex-row items-center justify-between">
        <Text className="font-sans-bold text-white text-sm">{t("mc_add_seat")} {seatNumber}</Text>
        <Pressable onPress={onClose} className="w-7 h-7 rounded-lg bg-white/15 items-center justify-center active:opacity-80">
          <X size={14} color="#fff" />
        </Pressable>
      </View>
      <View className="p-3" style={{ gap: 8 }}>
        <TextInput
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            if (!touched) setTouched(true);
          }}
          placeholder={t("mc_phone_req")}
          placeholderTextColor={colors.mutedForeground}
          keyboardType="phone-pad"
          className={`px-3 py-2.5 rounded-lg bg-muted border text-foreground text-sm ${
            touched && !phoneValid ? "border-red-500" : "border-border"
          }`}
          style={{ color: colors.foreground }}
        />
        {touched && !phoneValid ? (
          <Text className="font-sans text-red-400 text-[12px]">{t("mc_phone_err")}</Text>
        ) : null}

        <Text className="font-sans text-muted-foreground text-[11px] uppercase mt-0.5" style={{ letterSpacing: 0.5 }}>
          {t("mc_gender")}
        </Text>
        <View className="flex-row" style={{ gap: 8 }}>
          {[
            { g: "male", label: t("mc_male") },
            { g: "female", label: t("mc_female") },
          ].map((b) => {
            const disabled = loading || !phoneValid;
            return (
              <Pressable
                key={b.g}
                onPress={() => submit(b.g)}
                disabled={disabled}
                className="flex-1 py-3 rounded-xl bg-muted border border-border flex-row items-center justify-center active:opacity-80"
                style={{ gap: 6, opacity: disabled ? 0.4 : 1 }}
              >
                {loading ? <ActivityIndicator size="small" color={colors.foreground} /> : <User size={18} color={colors.foreground} />}
                <Text className="font-sans-bold text-foreground text-sm">{b.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
