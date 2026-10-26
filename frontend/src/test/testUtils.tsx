import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import type { ReactNode } from "react";

import { createQueryClient } from "../api/queryClient";
import type { Category, Product, ProductListResponse, ProductQuery } from "../types/catalog";

// The production client with retry delays removed, so retry behaviour is testable without waiting.
export function createTestQueryClient(): QueryClient {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retryDelay: 0 } });
  return client;
}

export function queryWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

export const ok = <T,>(data: T) => ({ data }) as AxiosResponse<T>;

export function makeProduct(id: number, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name: `Product ${id}`,
    description: null,
    price: "100000",
    stock: 5,
    category_id: 1,
    image_url: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeCategory(id: number, name = `Category ${id}`): Category {
  return { id, name, description: null, created_at: "2026-01-01T00:00:00Z" };
}

export function makeList(items: Product[], overrides: Partial<ProductListResponse> = {}): ProductListResponse {
  return { items, total: items.length, page: 1, page_size: 10, total_pages: items.length ? 1 : 0, ...overrides };
}

export function makeQuery(overrides: Partial<ProductQuery> = {}): ProductQuery {
  return { page: 1, page_size: 10, sort_by: "created_at", order: "desc", ...overrides };
}
