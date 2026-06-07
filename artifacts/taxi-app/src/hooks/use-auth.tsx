import { setSentryUser, clearSentryUser } from "@/lib/sentry";
import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";

import { useGetMe, type User } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

function safeGetJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    try { localStorage.removeItem(key); } catch {}
    return fallback;
  }
}

function safeSetJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch {}
}

function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => safeGetItem("authToken"));
  const [user, setUser] = useState<User | null>(() => safeGetJSON<User | null>("authUser", null));

  const queryClient = useQueryClient();
  const fetchInterceptorRef = useRef(false);

  const { data: me, isLoading, error: meError } = useGetMe({
    request: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    query: {
      enabled: !!token,
      refetchInterval: user?.role === "driver" ? 8000 : false,
      retry: (failureCount, err: any) => {
        if (err?.status === 401 || err?.response?.status === 401) return false;
        return failureCount < 2;
      },
    },
  });

  const clearAuth = useCallback(() => {
    setToken(null);
    setUser(null);
    safeRemove("authToken");
    safeRemove("authUser");
    safeRemove("sessionToken");
    clearSentryUser();
  }, []);

  useEffect(() => {
    if (me && !("error" in me)) {
      setUser(me as unknown as User);
      safeSetJSON("authUser", me);
      const u = me as any; if (u.id) setSentryUser({ id: u.id, name: u.name, role: u.role });
    }
    if (me && "error" in me && (me as any).error === "unauthorized") {
      clearAuth();
    }
  }, [me, clearAuth]);

  useEffect(() => {
    if (meError && token) {
      const status = (meError as any)?.status || (meError as any)?.response?.status;
      if (status === 401) {
        clearAuth();
      }
    }
  }, [meError, token, clearAuth]);

  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const data = (e as CustomEvent).detail;
        if (data?.type === "driver_update" && data.driver) {
          const updated = data.driver as User;
          setUser(prev => {
            if (prev && updated.id !== prev.id) return prev;
            const merged = prev ? { ...prev, ...updated } : updated;
            safeSetJSON("authUser", merged);
            return merged;
          });
        }
        if (data?.type === "force_logout" || data?.type === "session_replaced") {
          clearAuth();
        }
      } catch {}
    };
    window.addEventListener("buxtaxi:ws", handler);
    return () => window.removeEventListener("buxtaxi:ws", handler);
  }, [clearAuth]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!token) return;
    const tryRefresh = async () => {
      try {
        const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
        const res = await fetch(`${base}/api/auth/refresh-token`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.refreshed && data.token) {
            setToken(data.token);
            try { localStorage.setItem("authToken", data.token); } catch {}
            try { (window as any).AndroidBg?.setAuthToken?.(data.token); } catch {}
            console.log("[AUTH] Token refreshed");
          }
        }
      } catch {}
    };
    tryRefresh();
    refreshTimerRef.current = setInterval(tryRefresh, 24 * 60 * 60 * 1000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [token]);

  useEffect(() => {
    if (!token || fetchInterceptorRef.current) return;
    fetchInterceptorRef.current = true;
    const origFetch = window.fetch;
    const interceptedFetch: typeof fetch = async (...args) => {
      try {
        const response = await origFetch(...args);
        if (response.status === 401) {
          const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url || "";
          if (url.includes("/api/") && !url.includes("/api/auth/login")) {
            const body = await response.clone().json().catch(() => null);
            if (body?.error === "session_expired") {
              clearAuth();
            }
          }
        }
        return response;
      } catch (err) {
        throw err;
      }
    };
    window.fetch = interceptedFetch;
    return () => {
      window.fetch = origFetch;
      fetchInterceptorRef.current = false;
    };
  }, [token, clearAuth]);

  const refreshUser = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  }, [queryClient]);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    try {
      localStorage.setItem("authToken", newToken);
    } catch {}
    safeSetJSON("authUser", newUser);
    setSentryUser({ id: newUser.id, name: newUser.name, role: newUser.role });
    try {
      const wAny = window as any;
      if (newUser.role === "driver") {
        wAny.AndroidBg?.setAuthToken?.(newToken);
        wAny.AndroidBg?.startBackgroundService?.();
      }
    } catch {}
  };

  const logout = () => {
    // Capture role before clearAuth() nulls the user — drivers must land on the
    // driver login, not /login (which redirects to the dispatcher login).
    const role = user?.role;
    try { (window as any).AndroidBg?.clearAuthToken?.(); } catch {}
    clearAuth();
    safeRemove("buxtaxi_sip_config");
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    window.location.href = base + (role === "driver" ? "/driver-login" : "/login");
  };

  useEffect(() => {
    if (!token || !user) return;
    try {
      const wAny = window as any;
      if (user.role === "driver") {
        wAny.AndroidBg?.setAuthToken?.(token);
        wAny.AndroidBg?.startBackgroundService?.();
      }
    } catch {}
  }, [token, user]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
