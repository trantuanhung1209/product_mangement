import { api } from "./client";
import type { AuthUser } from "../types/catalog";

export const getCurrentUser = (signal?: AbortSignal) => api.get<AuthUser>("/api/v1/auth/me", { signal });
export const login = (email: string, password: string) => api.post<AuthUser>("/api/v1/auth/login", { email, password });
export const logout = () => api.post("/api/v1/auth/logout");
export const refresh = () => api.post("/api/v1/auth/refresh");
