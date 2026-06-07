import { View, Text } from "react-native";

import type { Ride } from "../types";

// Web stub — @maplibre/maplibre-react-native is native-only. Metro resolves this
// file for the web bundle so the design-preview build doesn't pull native code.
// The real map (RideMap.tsx) renders on Android.
export function RideMap({ ride, height = 200 }: { ride: Ride; height?: number }) {
  void ride;
  return (
    <View
      style={{ height, borderRadius: 16 }}
      className="bg-card border border-border items-center justify-center overflow-hidden"
    >
      <Text className="font-sans text-muted-foreground text-sm">Карта (только на устройстве)</Text>
    </View>
  );
}
