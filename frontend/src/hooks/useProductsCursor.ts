import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getProductsCursor } from "../api/products";
import { productKeys } from "../api/queryKeys";
import type { ProductCursorFilters } from "../types/catalog";

// Forward-only "load more" over GET /products/cursor. The server signs each cursor for the
// filters it was issued with, so changing a filter changes the key and starts again from page 1.
export function useProductsCursor(filters: ProductCursorFilters, { enabled = true }: { enabled?: boolean } = {}) {
  const result = useInfiniteQuery({
    queryKey: productKeys.cursorList(filters),
    queryFn: async ({ pageParam, signal }) => (await getProductsCursor({ ...filters, cursor: pageParam }, signal)).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled,
  });
  const items = useMemo(() => result.data?.pages.flatMap((page) => page.items) ?? [], [result.data]);
  return {
    items,
    hasMore: result.hasNextPage,
    loading: enabled && (result.isPending || (result.isError && result.isFetching && !result.isFetchNextPageError)),
    loadingMore: result.isFetchingNextPage,
    // A failed first page replaces the list; a failed "load more" keeps what is already shown.
    error: enabled && result.isError && !result.isFetching && !result.isFetchNextPageError,
    loadMoreError: result.isFetchNextPageError && !result.isFetchingNextPage,
    loadMore: () => void result.fetchNextPage(),
    retry: () => void result.refetch(),
  };
}
