import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { getProducts } from "../api/products";
import { productKeys } from "../api/queryKeys";
import type { ProductQuery } from "../types/catalog";

// While a new filter or page loads, the previous result stays on screen (`updating`) so the page
// does not blank out. It is stale by definition: callers must mark it as such (dimmed, aria-busy)
// and disable anything that depends on it, such as page buttons that compute the next page from it.
export function useProducts(query: ProductQuery, { enabled = true }: { enabled?: boolean } = {}) {
  const result = useQuery({
    enabled,
    placeholderData: keepPreviousData,
    queryKey: productKeys.list(query),
    queryFn: async ({ signal }) => (await getProducts(query, signal)).data,
  });
  return {
    data: result.data,
    updating: enabled && result.isPlaceholderData,
    loading: enabled && (result.isPending || (result.isError && result.isFetching)),
    error: enabled && result.isError && !result.isFetching,
    retry: () => void result.refetch(),
  };
}
