import { Modal, View, Text, Pressable, ActivityIndicator } from "react-native";
import { Clock, Navigation, XCircle } from "lucide-react-native";

import { useT } from "@/lib/i18n";

// Ported from web orders/components/ExpiredRideModal.tsx.
export function ExpiredRideModal({
  visible,
  extending,
  filledSeats,
  onExtend,
  onStartRide,
  onEndRide,
  onClose,
}: {
  visible: boolean;
  extending: boolean;
  filledSeats: number;
  onExtend: () => void;
  onStartRide: () => void;
  onEndRide: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 items-center justify-center px-6">
        <View className="w-full max-w-sm bg-card rounded-2xl overflow-hidden">
          <View className="bg-zinc-900 p-5 items-center">
            <Clock size={40} color="#fff" />
            <Text className="font-display text-white text-lg mt-2">{t("exp_title")}</Text>
            <Text className="font-sans text-white/80 text-sm mt-1 text-center">
              {t("exp_sub")}
            </Text>
          </View>
          <View className="p-4" style={{ gap: 10 }}>
            <Pressable
              onPress={onExtend}
              disabled={extending}
              className="py-3.5 rounded-xl bg-primary flex-row items-center justify-center active:opacity-90"
              style={{ gap: 8 }}
            >
              {extending ? <ActivityIndicator color="#fff" /> : <Clock size={16} color="#fff" />}
              <Text className="font-sans-bold text-white text-sm">{t("exp_extend")}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onClose();
                onStartRide();
              }}
              disabled={filledSeats === 0}
              className={`py-3.5 rounded-xl bg-zinc-900 flex-row items-center justify-center active:opacity-90 ${filledSeats === 0 ? "opacity-50" : ""}`}
              style={{ gap: 8 }}
            >
              <Navigation size={16} color="#fff" />
              <Text className="font-sans-bold text-white text-sm">{t("exp_start")}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onClose();
                onEndRide();
              }}
              className="py-3.5 rounded-xl bg-red-500/10 border border-red-500/20 flex-row items-center justify-center active:opacity-90"
              style={{ gap: 8 }}
            >
              <XCircle size={16} color="#ef4444" />
              <Text className="font-sans-bold text-red-500 text-sm">{t("cancel_ride")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
