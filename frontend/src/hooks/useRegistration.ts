import { useMutation } from "@tanstack/react-query";

import * as authApi from "../api/auth";
import { useAuth } from "../auth/AuthContext";

// gcTime 0: a finished mutation (which holds the password and OTP as variables) is dropped at once.
export function useRequestRegistrationOtp() {
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) =>
      (await authApi.requestRegistrationOtp(input.email, input.password)).data,
    gcTime: 0,
  });
}

export function useResendRegistrationOtp() {
  return useMutation({
    mutationFn: async (email: string) => (await authApi.resendRegistrationOtp(email)).data,
    gcTime: 0,
  });
}

export function useVerifyRegistrationOtp() {
  const { adoptSignedInUser } = useAuth();
  return useMutation({
    mutationFn: async (input: { email: string; otp: string }) =>
      (await authApi.verifyRegistrationOtp(input.email, input.otp)).data,
    onSuccess: adoptSignedInUser,
    gcTime: 0,
  });
}
