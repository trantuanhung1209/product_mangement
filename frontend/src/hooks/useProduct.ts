import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import { getProduct } from "../api/products";
import { productKeys } from "../api/queryKeys";

interface UseProductOptions {
  // Edit forms copy the product into local state once, so they must start from
  // server data fetched after mount rather than a cached copy.
  freshForEdit?: boolean;
  // Lets a mounted page stop the query from re-creating (and refetching) a product it just deleted.
  enabled?: boolean;
}

export function useProduct(productId: number, { freshForEdit = false, enabled = true }: UseProductOptions = {}) {
  const result = useQuery({
    queryKey: productKeys.detail(productId),
    queryFn: async ({ signal }) => (await getProduct(productId, signal)).data,
    enabled: enabled && Number.isInteger(productId) && productId > 0,
    ...(freshForEdit && { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: false }),
  });
  const invalidId = !Number.isInteger(productId) || productId <= 0;
  return {
    product: result.data,
    loading: !invalidId && (result.isPending || (freshForEdit && !result.isFetchedAfterMount)),
    error: invalidId || result.isError,
    // The product does not exist (or the id is malformed). Any other failure may be temporary,
    // so screens offer a retry instead of telling the user the product is gone.
    notFound: invalidId || (isAxiosError(result.error) && [404, 422].includes(result.error.response?.status ?? 0)),
    retry: () => void result.refetch(),
  };
}
