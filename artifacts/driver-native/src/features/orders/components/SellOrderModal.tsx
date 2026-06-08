import { useState } from "react";
import { View, Text, Pressable, TextInput, Modal, ActivityIndicator } from "react-native";
import { Store, X } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { formatCurrency } from "../utils";

// Driver sells / returns the current order to the operator (marketplace).
// POST /api/marketplace/sell { rideId, price, comment? }.
export function SellOrderModal({
  visible,
  defaultPrice,
  loading,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  defaultPrice: number;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (price: number, comment: string) => void;
}) {
  const [price, setPrice] = useState(String(defaultPrice || ""));
  const [comment, setComment] = useState("");

  const priceNum = Number(price.replace(/\D/g, ""));
  const valid = priceNum > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end">
        <View className="bg-card rounded-t-3xl border-t border-border p-4" style={{ gap: 12 }}>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Store size={20} color={colors.primary} />
              <Text className="font-display text-foreground text-lg">Продать заказ оператору</Text>
            </View>
            <Pressable onPress={onClose} className="w-8 h-8 rounded-full bg-secondary items-center justify-center active:opacity-80">
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>

          <Text className="font-sans text-muted-foreground text-[13px]" style={{ lineHeight: 19 }}>
            Заказ будет выставлен на продажу — его сможет выкупить другой водитель через оператора.
          </Text>

          <View>
            <Text className="font-sans-bold text-muted-foreground text-[11px] uppercase mb-1.5" style={{ letterSpacing: 0.5 }}>
              Цена
            </Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="number-pad"
              placeholder="Цена"
              placeholderTextColor={colors.mutedForeground}
              className="px-3 py-3 rounded-xl bg-muted border border-border text-foreground text-base"
              style={{ color: colors.foreground }}
            />
            {valid ? (
              <Text className="font-sans text-muted-foreground text-[12px] mt-1">{formatCurrency(priceNum)}</Text>
            ) : null}
          </View>

          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Комментарий (необязательно)"
            placeholderTextColor={colors.mutedForeground}
            className="px-3 py-3 rounded-xl bg-muted border border-border text-foreground text-sm"
            style={{ color: colors.foreground }}
          />

          <Pressable
            onPress={() => valid && onConfirm(priceNum, comment.trim())}
            disabled={!valid || loading}
            className="h-13 py-3.5 rounded-2xl bg-primary flex-row items-center justify-center active:opacity-90"
            style={{ gap: 8, opacity: !valid || loading ? 0.5 : 1 }}
          >
            {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Store size={18} color={colors.primaryForeground} />}
            <Text className="font-sans-bold text-primary-foreground text-sm">Выставить на продажу</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
