import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 8_000,
  withCredentials: true,
});
let refreshRequest: Promise<unknown> | null = null;

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
  refreshRequest ??= api.post("/api/v1/auth/refresh").finally(() => { refreshRequest = null; });
  try { await refreshRequest; return api(request); } catch { return Promise.reject(error); }
});
