import { useQuery } from "@tanstack/react-query";

import { getProducts } from "../api/products";
import { productKeys } from "../api/queryKeys";
import type { ProductQuery } from "../types/catalog";

// No placeholderData: when filters or page change, the new key has no data yet,
// so `loading` is true instead of showing the previous result as if it were new.
export function useProducts(query: ProductQuery, { enabled = true }: { enabled?: boolean } = {}) {
  const result = useQuery({
    enabled,
    queryKey: productKeys.list(query),
    queryFn: async ({ signal }) => (await getProducts(query, signal)).data,
  });
  return {
    data: result.data,
    loading: enabled && (result.isPending || (result.isError && result.isFetching)),
    error: enabled && result.isError && !result.isFetching,
    retry: () => void result.refetch(),
  };
}
