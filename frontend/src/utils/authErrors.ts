import { isAxiosError } from "axios";

// Only a fallback for a 429 without Retry-After; countdowns normally use what the server returns.
const FALLBACK_WAIT_SECONDS = 60;
export const GENERIC_ERROR = "Có lỗi xảy ra. Vui lòng thử lại.";

export function waitSeconds(error: unknown): number | null {
  if (!isAxiosError(error) || error.response?.status !== 429) return null;
  const parsed = Number(error.response.headers?.["retry-after"]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : FALLBACK_WAIT_SECONDS;
}

export function describeError(error: unknown): string {
  const wait = waitSeconds(error);
  if (wait !== null) return `Bạn thao tác quá nhanh. Vui lòng đợi ${wait} giây rồi thử lại.`;
  if (isAxiosError(error) && typeof error.response?.data?.detail === "string" && [400, 503].includes(error.response.status))
    return error.response.data.detail;
  return GENERIC_ERROR;
}

export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
