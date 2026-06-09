import "../global.css";

import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import {
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from "@expo-google-fonts/outfit";
import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";

import { configureApi } from "@/api";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/hooks/use-auth";
import { useSettingsStore, fontScaleOf } from "@/stores/settings";
import { colors, applyThemeColors } from "@/lib/theme";
import { themeVars, setFontScale, patchFontScaling } from "@/lib/theme-runtime";
import { configurePushHandler } from "@/native/push";

// Point the shared API client at the live backend + token store, once.
configureApi();
// Foreground notification presentation behavior (FCM-ready scaffold).
configurePushHandler();
// Enable global font scaling (no-op until the driver picks a non-default size).
patchFontScaling();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const hydrate = useSettingsStore((s) => s.hydrate);
  const hydrated = useSettingsStore((s) => s.hydrated);
  const theme = useSettingsStore((s) => s.theme);
  const fontSize = useSettingsStore((s) => s.fontSize);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Apply the live theme + font scale before rendering children so colors.* and
  // the className CSS vars are consistent this frame.
  applyThemeColors(theme);
  setFontScale(fontScaleOf(fontSize));

  if (!fontsLoaded || !hydrated) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style={theme === "light" ? "dark" : "light"} />
            {/* themeVars cascades the CSS variables to all screens. The key forces
                a re-mount when theme / font size changes so every visible screen
                re-reads colors.* and the scaled font sizes immediately (expo-router
                restores the current route from the URL, so the driver stays put). */}
            <View key={`${theme}:${fontSize}`} style={[{ flex: 1 }, themeVars(theme)]}>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.background },
                }}
              >
                <Stack.Screen name="(driver)" />
                <Stack.Screen name="driver-login" />
              </Stack>
            </View>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
