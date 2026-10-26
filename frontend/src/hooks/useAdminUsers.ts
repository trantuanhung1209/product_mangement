import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getAdminUserSessions, getAdminUsers, revokeAdminSession, revokeAllAdminSessions } from "../api/auth";
import { adminKeys } from "../api/queryKeys";

interface AdminUsersParams {
  page: number;
  page_size: number;
  search?: string;
}

export function useAdminUsers(params: AdminUsersParams) {
  const result = useQuery({
    queryKey: adminKeys.userList(params),
    queryFn: async ({ signal }) => (await getAdminUsers(params, signal)).data,
    staleTime: 0,
  });
  return { data: result.data, error: result.isError, retry: () => void result.refetch() };
}

export function useAdminUserSessions(userId: string) {
  const result = useQuery({
    queryKey: adminKeys.userSessions(userId),
    queryFn: async ({ signal }) => (await getAdminUserSessions(userId, signal)).data,
    enabled: userId !== "",
    staleTime: 0,
  });
  return { data: result.data, error: result.isError, retry: () => void result.refetch() };
}

// A null sessionId revokes every session of this user; either way only this user's session data changes.
export function useRevokeAdminSessions(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string | null) => {
      if (sessionId === null) return (await revokeAllAdminSessions(userId)).data;
      await revokeAdminSession(userId, sessionId);
      return undefined;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.userSessions(userId) }),
  });
}
