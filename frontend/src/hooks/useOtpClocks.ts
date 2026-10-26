import { useCallback, useEffect, useState } from "react";

import type { RegistrationAccepted } from "../api/auth";

// Countdowns for the code lifetime and the resend cooldown. Durations come from the server.
export function useOtpClocks(active: boolean) {
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const start = useCallback((timings: RegistrationAccepted) => {
    const current = Date.now();
    setNow(current);
    setExpiresAt(current + timings.expires_in_seconds * 1000);
    setResendAt(current + timings.resend_in_seconds * 1000);
  }, []);
  const holdResendFor = useCallback((seconds: number) => {
    const current = Date.now();
    setNow(current);
    setResendAt(current + seconds * 1000);
  }, []);

  const remaining = Math.ceil((expiresAt - now) / 1000);
  return { start, holdResendFor, remaining, expired: remaining <= 0, resendIn: Math.max(0, Math.ceil((resendAt - now) / 1000)) };
}
