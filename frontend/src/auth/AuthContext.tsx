import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import * as authApi from "../api/auth";
import type { AuthUser } from "../types/catalog";

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void authApi
      .getCurrentUser(controller.signal)
      .then((response) => setUser(response.data))
      .catch(async (error: unknown) => {
        if (isAxiosError(error) && error.code === "ERR_CANCELED") return;
        const hasCsrf = document.cookie
          .split("; ")
          .some((cookie) => cookie.startsWith("csrf_token="));
        if (!hasCsrf) {
          setUser(null);
          return;
        }
        try {
          await authApi.refresh();
          const response = await authApi.getCurrentUser(controller.signal);
          setUser(response.data);
        } catch {
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  const login = async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    setUser(response.data);
    // Drop anything cached for the previous identity and refetch active queries with the new cookies.
    await queryClient.resetQueries();
    return response.data;
  };
  const logout = async () => {
    await authApi.logout();
    setUser(null);
    await queryClient.resetQueries();
  };
  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
