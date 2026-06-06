import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";

interface User {
  id: number;
  phone: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("clientToken"));
  const [user, setUser] = useState<User | null>(() => {
    try {
      const s = localStorage.getItem("clientUser");
      return s ? JSON.parse(s) : null;
    } catch {
      localStorage.removeItem("clientUser");
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    setAuthTokenGetter(() => token);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    fetch(`${import.meta.env.BASE_URL}api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((u) => {
        setUser(u);
        localStorage.setItem("clientUser", JSON.stringify(u));
      })
      .catch(() => {
        setToken(null);
        setUser(null);
        localStorage.removeItem("clientToken");
        localStorage.removeItem("clientUser");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(
    (t: string, u: User) => {
      setToken(t);
      setUser(u);
      localStorage.setItem("clientToken", t);
      localStorage.setItem("clientUser", JSON.stringify(u));
    },
    [],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("clientToken");
    localStorage.removeItem("clientUser");
    queryClient.clear();
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
