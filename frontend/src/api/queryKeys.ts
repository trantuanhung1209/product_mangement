import type { ProductQuery } from "../types/catalog";

// Only fields that change the server response belong in the key. Picking them
// explicitly keeps keys stable if callers pass extra properties.
function listFilters(query: ProductQuery): ProductQuery {
  return {
    page: query.page,
    page_size: query.page_size,
    search: query.search,
    category_id: query.category_id,
    min_price: query.min_price,
    max_price: query.max_price,
    sort_by: query.sort_by,
    order: query.order,
  };
}

export const productKeys = {
  all: ["products"] as const,
  lists: () => [...productKeys.all, "list"] as const,
  list: (query: ProductQuery) => [...productKeys.lists(), listFilters(query)] as const,
  details: () => [...productKeys.all, "detail"] as const,
  detail: (productId: number) => [...productKeys.details(), productId] as const,
};

export const categoryKeys = {
  all: ["categories"] as const,
  lists: () => [...categoryKeys.all, "list"] as const,
};
