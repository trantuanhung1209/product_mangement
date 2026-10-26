import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createCategory, deleteCategory, updateCategory } from "../api/categories";
import { categoryKeys } from "../api/queryKeys";
import type { CategoryPayload } from "../types/catalog";

// Products reference categories by id and the UI resolves names from the
// categories list, so only the categories cache needs refreshing.
export function useSaveCategory(categoryId?: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CategoryPayload) =>
      (categoryId === undefined ? await createCategory(payload) : await updateCategory(categoryId, payload)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (categoryId: number) => {
      await deleteCategory(categoryId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
  });
}
