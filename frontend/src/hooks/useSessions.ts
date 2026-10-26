import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getSessions, revokeOtherSessions, revokeSession } from "../api/auth";
import { sessionKeys } from "../api/queryKeys";

// Session lists are security information, so they are always refetched on mount (staleTime 0).
export function useMySessions(userId: number | undefined) {
  const result = useQuery({
    queryKey: sessionKeys.mine(userId ?? 0),
    queryFn: async ({ signal }) => (await getSessions(signal)).data,
    enabled: userId !== undefined,
    staleTime: 0,
  });
  return {
    sessions: result.data ?? [],
    loading: result.isPending,
    error: result.isError,
    retry: () => void result.refetch(),
  };
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      await revokeSession(sessionId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await revokeOtherSessions()).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
  });
}
