import { useState, useRef, useCallback } from "react";
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

const CODE_LENGTH = 6;

// Login-by-code (the "code-only" path from web DriverLogin.tsx):
// POST /api/auth/driver-code/verify-code-only { code } -> { token, user }.
// Polished segmented 6-cell OTP input (hidden field drives the cells).
export default function DriverLogin() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const { login } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const submit = useCallback(
    async (value: string) => {
      const codeVal = value.trim();
      if (codeVal.length < CODE_LENGTH) {
        setError(`Введите ${CODE_LENGTH}-значный код`);
        return;
      }
      setLoading(true);
      setError(null);
      const url = `${API_BASE_URL}/api/auth/driver-code/verify-code-only`;
      try {
        console.log("[LOGIN] POST", url, "body:", JSON.stringify({ code: codeVal }));
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: codeVal }),
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
    },
    [login, router],
  );

  const onChange = (v: string) => {
    const digits = v.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    if (digits.length === CODE_LENGTH) submit(digits); // auto-submit when full
  };

  const cells = Array.from({ length: CODE_LENGTH });

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

        <Text
          className="font-sans-semibold text-muted-foreground text-[12px] uppercase mb-3 text-center"
          style={{ letterSpacing: 1 }}
        >
          Код водителя
        </Text>

        {/* Segmented OTP cells (tap to focus the hidden input) */}
        <Pressable
          className="flex-row justify-between"
          onPress={() => inputRef.current?.focus()}
        >
          {cells.map((_, i) => {
            const char = code[i] ?? "";
            const isActive = focused && i === code.length;
            const filled = !!char;
            return (
              <View
                key={i}
                className={`rounded-2xl border-2 items-center justify-center ${
                  isActive
                    ? "border-primary bg-secondary"
                    : filled
                      ? "border-primary/40 bg-secondary"
                      : "border-border bg-secondary/60"
                }`}
                style={{ width: 48, height: 58 }}
              >
                <Text className="font-sans-bold text-foreground text-2xl">{char || ""}</Text>
              </View>
            );
          })}
        </Pressable>

        {/* Hidden input that actually captures the digits */}
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          autoFocus
          caretHidden
          style={{ position: "absolute", opacity: 0, height: 1, width: 1 }}
        />

        {error ? (
          <Text className="font-sans text-red-400 text-sm mt-4 text-center">{error}</Text>
        ) : null}

        <Pressable
          onPress={() => submit(code)}
          disabled={loading || code.length < CODE_LENGTH}
          className={`mt-6 rounded-2xl py-4 items-center bg-primary active:opacity-90 ${
            loading || code.length < CODE_LENGTH ? "opacity-50" : ""
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
