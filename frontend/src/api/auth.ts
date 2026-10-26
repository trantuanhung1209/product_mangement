import { api } from "./client";
import type { AdminUserList, AdminUserSessions, LoginSession } from "../types/catalog";
import type { AuthUser } from "../types/catalog";

export const getCurrentUser = (signal?: AbortSignal) => api.get<AuthUser>("/api/v1/auth/me", { signal });
export const login = (email: string, password: string) => api.post<AuthUser>("/api/v1/auth/login", { email, password });
export interface RegistrationAccepted {
  message: string;
  expires_in_seconds: number;
  resend_in_seconds: number;
}
export const requestRegistrationOtp = (email: string, password: string) =>
  api.post<RegistrationAccepted>("/api/v1/auth/register/request-otp", { email, password });
export const resendRegistrationOtp = (email: string) =>
  api.post<RegistrationAccepted>("/api/v1/auth/register/resend-otp", { email });
export const verifyRegistrationOtp = (email: string, otp: string) =>
  api.post<AuthUser>("/api/v1/auth/register/verify-otp", { email, otp });
export const forgotPassword = (email: string) =>
  api.post<RegistrationAccepted>("/api/v1/auth/password/forgot", { email });
export const resetPassword = (email: string, otp: string, newPassword: string) =>
  api.post("/api/v1/auth/password/reset", { email, otp, new_password: newPassword });
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.post("/api/v1/auth/password/change", { current_password: currentPassword, new_password: newPassword });
export const logout = () => api.post("/api/v1/auth/logout");
export const refresh = () => api.post("/api/v1/auth/refresh");
export const getSessions = (signal?: AbortSignal) => api.get<LoginSession[]>("/api/v1/auth/sessions", { signal });
export const revokeSession = (sessionId: string) => api.delete(`/api/v1/auth/sessions/${sessionId}`);
export const revokeOtherSessions = () => api.delete<{ revoked_count: number }>("/api/v1/auth/sessions/others");
export const getAdminUsers = (params: { page: number; page_size: number; search?: string }, signal?: AbortSignal) => api.get<AdminUserList>("/api/v1/admin/users", { params, signal });
export const getAdminUserSessions = (userId: string, signal?: AbortSignal) => api.get<AdminUserSessions>(`/api/v1/admin/users/${userId}/sessions`, { signal });
export const revokeAdminSession = (userId: string, sessionId: string) => api.delete(`/api/v1/admin/users/${userId}/sessions/${sessionId}`);
export const revokeAllAdminSessions = (userId: string) => api.delete<{ revoked_count: number }>(`/api/v1/admin/users/${userId}/sessions`);
