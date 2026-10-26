import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import * as authApi from "../api/auth";
import { setSessionExpiredHandler } from "../api/client";
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
  const signedIn = useRef(false);
  const endClientSession = useCallback(() => {
    signedIn.current = false;
    setUser(null);
  }, []);
  // Whenever the signed-in identity changes (login, logout, expired session) drop every cached
  // response. This runs after render, so observers already point at the new identity's keys and
  // only those are refetched; the first resolved identity after page load is not a change.
  const identity = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (loading) return;
    const current = user?.id ?? null;
    if (identity.current !== undefined && identity.current !== current) void queryClient.resetQueries();
    identity.current = current;
  }, [loading, user?.id, queryClient]);
  // A rejected refresh means the session is dead: drop the user and every cached response.
  // Route guards then send protected pages to /login. The signedIn guard stops requests
  // refetched by resetQueries (which may 401 again) from re-triggering this.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      if (signedIn.current) endClientSession();
    });
    return () => setSessionExpiredHandler(null);
  }, [endClientSession]);
  useEffect(() => {
    const controller = new AbortController();
    void authApi
      .getCurrentUser(controller.signal)
      .then((response) => {
        signedIn.current = true;
        setUser(response.data);
      })
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
          signedIn.current = true;
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
    signedIn.current = true;
    setUser(response.data);
    return response.data;
  };
  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // The server-side revoke failed, but the client must not keep showing this user's data.
    }
    endClientSession();
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
