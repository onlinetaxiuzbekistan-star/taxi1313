import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";

// Functional login-by-code (the "code-only" path from web DriverLogin.tsx):
// POST /api/auth/driver-code/verify-code-only { code } -> { token, user }.
// Styled to the new driver (cyan) theme; full SMS flow + onboarding come later.
export default function DriverLogin() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const submit = async () => {
    if (code.trim().length < 4) {
      setError("Введите код водителя");
      return;
    }
    setLoading(true);
    setError(null);
    const url = `${API_BASE_URL}/api/auth/driver-code/verify-code-only`;
    try {
      console.log("[LOGIN] POST", url, "body:", JSON.stringify({ code: code.trim() }));
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const text = await res.text();
      console.log("[LOGIN] status:", res.status, "ct:", res.headers.get("content-type"), "body:", text.slice(0, 300));
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
      if (res.ok && data?.token && data?.user) {
        await login(data.token, data.user);
        router.replace("/(driver)");
      } else {
        setError(data?.message || data?.error || `Неверный код (HTTP ${res.status})`);
      }
    } catch (e) {
      console.log("[LOGIN] network error:", (e as Error)?.message);
      setError("Ошибка сети");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="flex-1 justify-center px-7">
        <View className="items-center mb-10">
          <Image
            source={require("../assets/logo-1313.png")}
            style={{ width: 96, height: 96, borderRadius: 24 }}
            resizeMode="contain"
          />
          <Text className="font-display text-foreground text-2xl mt-4">Taxi 1313</Text>
          <Text className="font-sans text-muted-foreground text-sm mt-1">Вход для водителя</Text>
        </View>

        <Text className="font-sans-semibold text-muted-foreground text-[12px] uppercase mb-2" style={{ letterSpacing: 1 }}>
          Код водителя
        </Text>
        <TextInput
          value={code}
          onChangeText={(v) => {
            setCode(v.replace(/[^0-9]/g, ""));
            setError(null);
          }}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="• • • • • •"
          placeholderTextColor={colors.mutedForeground}
          className="bg-secondary border border-border rounded-2xl text-foreground text-center text-2xl px-4 py-4 font-sans-bold"
          style={{ letterSpacing: 8 }}
        />

        {error ? (
          <Text className="font-sans text-red-400 text-sm mt-3 text-center">{error}</Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={loading}
          className={`mt-6 rounded-2xl py-4 items-center bg-primary active:opacity-90 ${
            loading ? "opacity-60" : ""
          }`}
        >
          {loading ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text className="font-sans-bold text-primary-foreground text-base">Войти</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
