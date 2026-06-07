import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";

import { useGetMe, getGetMeQueryKey } from "@/api";
import { tokenStore, jsonStore } from "@/lib/storage";
import { wsEvents } from "@/lib/ws-events";
import type { DriverUser } from "@/types";

// React Native port of web taxi-app/src/hooks/use-auth.tsx.
// Differences: SecureStore/AsyncStorage instead of localStorage, the WS event
// bus instead of window events, and expo-router for the post-logout redirect.
// The bearer token is attached globally by configureApi()'s token getter, so we
// don't pass an Authorization header per request here.

const USER_KEY = "authUser";

interface AuthContextType {
  user: DriverUser | null;
  token: string | null;
  isLoading: boolean;
  hydrated: boolean;
  login: (token: string, user: DriverUser) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<DriverUser | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const queryClient = useQueryClient();

  // Hydrate persisted session once on mount.
  useEffect(() => {
    (async () => {
      const [t, u] = await Promise.all([
        tokenStore.get(),
        jsonStore.get<DriverUser | null>(USER_KEY, null),
      ]);
      setToken(t);
      setUser(u);
      setHydrated(true);
    })();
  }, []);

  const { data: me, isLoading } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      refetchInterval: user?.role === "driver" ? 8000 : false,
      retry: (failureCount: number, err: any) => {
        const status = err?.status ?? err?.response?.status;
        if (status === 401) return false;
        return failureCount < 2;
      },
    },
  });

  const clearAuth = useCallback(async () => {
    setToken(null);
    setUser(null);
    await tokenStore.remove();
    await jsonStore.remove(USER_KEY);
  }, []);

  // Keep user fresh from /me.
  useEffect(() => {
    if (me && !("error" in (me as any))) {
      setUser(me as unknown as DriverUser);
      jsonStore.set(USER_KEY, me);
    }
    if (me && "error" in (me as any) && (me as any).error === "unauthorized") {
      clearAuth();
    }
  }, [me, clearAuth]);

  // React to driver pushes over the WS bus, mirroring the web provider.
  useEffect(() => {
    return wsEvents.on((data) => {
      if (data?.type === "driver_update" && (data as any).driver) {
        const updated = (data as any).driver as DriverUser;
        setUser((prev) => {
          if (prev && updated.id !== prev.id) return prev;
          const merged = prev ? { ...prev, ...updated } : updated;
          jsonStore.set(USER_KEY, merged);
          return merged;
        });
      }
      if (data?.type === "force_logout" || data?.type === "session_replaced") {
        clearAuth();
      }
    });
  }, [clearAuth]);

  const refreshUser = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  }, [queryClient]);

  const login = useCallback(async (newToken: string, newUser: DriverUser) => {
    setToken(newToken);
    setUser(newUser);
    await tokenStore.set(newToken);
    await jsonStore.set(USER_KEY, newUser);
  }, []);

  const logout = useCallback(async () => {
    await clearAuth();
    router.replace("/driver-login");
  }, [clearAuth]);

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, hydrated, login, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
