import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 8_000,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (["post", "put", "patch", "delete"].includes(config.method ?? "")) {
    const csrf = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf_token="))?.split("=")[1];
    if (csrf) config.headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  }
  return config;
});
