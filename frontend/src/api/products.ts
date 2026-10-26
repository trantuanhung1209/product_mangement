import { api } from "./client";
import type {
  Product,
  ProductCursorFilters,
  ProductCursorResponse,
  ProductListResponse,
  ProductPayload,
  ProductQuery,
} from "../types/catalog";

export function getProducts(params: ProductQuery, signal: AbortSignal) {
  return api.get<ProductListResponse>("/api/v1/products", { params, signal });
}

export function getProductsCursor(params: ProductCursorFilters & { cursor?: string }, signal: AbortSignal) {
  return api.get<ProductCursorResponse>("/api/v1/products/cursor", { params, signal });
}

export function getProduct(productId: number, signal: AbortSignal) {
  return api.get<Product>(`/api/v1/products/${productId}`, { signal });
}

export function createProduct(payload: ProductPayload, signal?: AbortSignal) {
  return api.post<Product>("/api/v1/products", payload, { signal });
}

export function updateProduct(productId: number, payload: ProductPayload, signal?: AbortSignal) {
  return api.put<Product>(`/api/v1/products/${productId}`, payload, { signal });
}

export function deleteProduct(productId: number, signal?: AbortSignal) {
  return api.delete(`/api/v1/products/${productId}`, { signal });
}

export function uploadProductImage(productId: number, file: File, signal?: AbortSignal) {
  const data = new FormData();
  data.append("file", file);
  return api.post<Product>(`/api/v1/products/${productId}/image`, data, { signal });
}
