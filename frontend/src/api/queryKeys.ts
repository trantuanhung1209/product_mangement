import type { ProductCursorFilters, ProductQuery } from "../types/catalog";

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

function cursorFilters(filters: ProductCursorFilters): ProductCursorFilters {
  return {
    limit: filters.limit,
    search: filters.search,
    category_id: filters.category_id,
    min_price: filters.min_price,
    max_price: filters.max_price,
  };
}

export const productKeys = {
  all: ["products"] as const,
  lists: () => [...productKeys.all, "list"] as const,
  list: (query: ProductQuery) => [...productKeys.lists(), listFilters(query)] as const,
  // Under lists(), so invalidating lists() also refreshes cursor lists. The cursor itself is a
  // page parameter of the infinite query, not part of the key.
  cursorList: (filters: ProductCursorFilters) => [...productKeys.lists(), "cursor", cursorFilters(filters)] as const,
  details: () => [...productKeys.all, "detail"] as const,
  detail: (productId: number) => [...productKeys.details(), productId] as const,
};

export const categoryKeys = {
  all: ["categories"] as const,
  lists: () => [...categoryKeys.all, "list"] as const,
};

// Per-user data: the user id is part of the key so one account can never read another's entry,
// even before AuthContext resets the cache on login/logout.
export const cartKeys = {
  all: ["cart"] as const,
  user: (userId: number) => [...cartKeys.all, userId] as const,
};

export const sessionKeys = {
  all: ["sessions"] as const,
  mine: (userId: number) => [...sessionKeys.all, "mine", userId] as const,
};

// Admin keys live under their own root so they never mix with the storefront's product keys.
export const adminKeys = {
  all: ["admin"] as const,
  users: () => [...adminKeys.all, "users"] as const,
  userList: (params: { page: number; page_size: number; search?: string }) => [...adminKeys.users(), "list", params] as const,
  userSessions: (userId: string) => [...adminKeys.users(), "sessions", userId] as const,
};
