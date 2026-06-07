import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// Token lives in the OS keystore on device (expo-secure-store); on web SecureStore
// is unavailable, so fall back to localStorage. Non-secret JSON (the cached user)
// always uses AsyncStorage (localStorage on web).

const isWeb = Platform.OS === "web";

export const tokenStore = {
  async get(): Promise<string | null> {
    try {
      if (isWeb) return globalThis.localStorage?.getItem("authToken") ?? null;
      return await SecureStore.getItemAsync("authToken");
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    try {
      if (isWeb) globalThis.localStorage?.setItem("authToken", token);
      else await SecureStore.setItemAsync("authToken", token);
    } catch {}
  },
  async remove(): Promise<void> {
    try {
      if (isWeb) globalThis.localStorage?.removeItem("authToken");
      else await SecureStore.deleteItemAsync("authToken");
    } catch {}
  },
};

export const jsonStore = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      try {
        await AsyncStorage.removeItem(key);
      } catch {}
      return fallback;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {}
  },
};
