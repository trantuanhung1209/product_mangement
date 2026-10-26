import { QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

const MAX_QUERY_RETRIES = 2;

// Retry only transient failures (network, timeout, 5xx). 4xx — including a 401
// that the Axios interceptor already tried to refresh — will not change on retry.
export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (isAxiosError(error)) {
    if (error.code === "ERR_CANCELED") return false;
    const status = error.response?.status;
    if (status !== undefined && status >= 400 && status < 500) return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
      },
      // Mutations are never retried automatically: a repeat POST could duplicate data.
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
