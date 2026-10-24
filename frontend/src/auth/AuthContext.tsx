import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isAxiosError } from "axios";

import * as authApi from "../api/auth";
import type { AuthUser } from "../types/catalog";

interface AuthValue { user: AuthUser | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; }
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { const controller = new AbortController(); void authApi.getCurrentUser(controller.signal).then((response) => setUser(response.data)).catch((error: unknown) => { if (!(isAxiosError(error) && error.code === "ERR_CANCELED")) setUser(null); }).finally(() => setLoading(false)); return () => controller.abort(); }, []);
  const login = async (email: string, password: string) => { const response = await authApi.login(email, password); setUser(response.data); };
  const logout = async () => { await authApi.logout(); setUser(null); };
  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error("useAuth must be used within AuthProvider."); return context; }
