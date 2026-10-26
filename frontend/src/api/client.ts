import axios, { isAxiosError } from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 8_000,
  withCredentials: true,
});

export function apiAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return new URL(url, api.defaults.baseURL ?? window.location.origin).toString();
}
let refreshRequest: Promise<unknown> | null = null;
let onSessionExpired: (() => void) | null = null;

// AuthContext registers here so a rejected refresh can end the client-side session.
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

api.interceptors.request.use((config) => {
  if (["post", "put", "patch", "delete"].includes(config.method ?? "")) {
    const csrf = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf_token="))?.split("=")[1];
    if (csrf) config.headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  }
  return config;
});

api.interceptors.response.use(undefined, async (error) => {
  const request = error.config as typeof error.config & { _retried?: boolean };
  if (error.response?.status !== 401 || request?._retried || request?.url?.includes("/auth/")) return Promise.reject(error);
  request._retried = true;
  // Only a definitive rejection (401/403) ends the session; network errors and 5xx may be temporary.
  refreshRequest ??= api.post("/api/v1/auth/refresh")
    .catch((refreshError: unknown) => {
      if (isAxiosError(refreshError) && [401, 403].includes(refreshError.response?.status ?? 0)) onSessionExpired?.();
      throw refreshError;
    })
    .finally(() => { refreshRequest = null; });
  try { await refreshRequest; } catch { return Promise.reject(error); }
  return api(request);
});
