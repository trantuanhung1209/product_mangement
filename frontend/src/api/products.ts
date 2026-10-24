import { api } from "./client";
import type { ProductListResponse, ProductQuery } from "../types/catalog";

export function getProducts(params: ProductQuery, signal: AbortSignal) {
  return api.get<ProductListResponse>("/api/v1/products", { params, signal });
}
