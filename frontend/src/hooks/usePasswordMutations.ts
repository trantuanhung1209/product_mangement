import { useMutation } from "@tanstack/react-query";

import * as authApi from "../api/auth";
import { useAuth } from "../auth/AuthContext";

// gcTime 0: finished mutations hold passwords and codes as variables, so they are dropped at once.
export function useForgotPassword() {
  return useMutation({
    mutationFn: async (email: string) => (await authApi.forgotPassword(email)).data,
    gcTime: 0,
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: { email: string; otp: string; newPassword: string }) => {
      await authApi.resetPassword(input.email, input.otp, input.newPassword);
    },
    gcTime: 0,
  });
}

// Success means the server ended every session, this one included. Clearing the session also resets
// every cached query (AuthContext reacts to the identity change).
export function useChangePassword() {
  const { clearSession } = useAuth();
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      await authApi.changePassword(input.currentPassword, input.newPassword);
    },
    onSuccess: clearSession,
    gcTime: 0,
  });
}
