import { api } from "./client";
import type { AdminUserList, LoginSession } from "../types/catalog";
import type { AuthUser } from "../types/catalog";

export const getCurrentUser = (signal?: AbortSignal) => api.get<AuthUser>("/api/v1/auth/me", { signal });
export const login = (email: string, password: string) => api.post<AuthUser>("/api/v1/auth/login", { email, password });
export const logout = () => api.post("/api/v1/auth/logout");
export const refresh = () => api.post("/api/v1/auth/refresh");
export const getSessions = () => api.get<LoginSession[]>("/api/v1/auth/sessions");
export const revokeSession = (sessionId: string) => api.delete(`/api/v1/auth/sessions/${sessionId}`);
export const revokeOtherSessions = () => api.delete<{ revoked_count: number }>("/api/v1/auth/sessions/others");
export const getAdminUsers = (params: { page: number; page_size: number; search?: string }) => api.get<AdminUserList>("/api/v1/admin/users", { params });
export const getAdminUserSessions = (userId: string) => api.get<{ user: AuthUser; active_session_count: number; sessions: LoginSession[] }>(`/api/v1/admin/users/${userId}/sessions`);
export const revokeAdminSession = (userId: string, sessionId: string) => api.delete(`/api/v1/admin/users/${userId}/sessions/${sessionId}`);
export const revokeAllAdminSessions = (userId: string) => api.delete<{ revoked_count: number }>(`/api/v1/admin/users/${userId}/sessions`);
