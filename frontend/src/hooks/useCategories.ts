import { useQuery } from "@tanstack/react-query";

import { getCategories } from "../api/categories";
import { categoryKeys } from "../api/queryKeys";

export function useCategories() {
  const result = useQuery({
    queryKey: categoryKeys.lists(),
    queryFn: async ({ signal }) => (await getCategories(signal)).data,
    staleTime: 5 * 60_000,
  });
  return {
    categories: result.data ?? [],
    loading: result.isPending,
    error: result.isError,
    retry: () => void result.refetch(),
  };
}
