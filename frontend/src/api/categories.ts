import { api } from "./client";
import type { Category, CategoryPayload } from "../types/catalog";

export function getCategories(signal: AbortSignal) {
  return api.get<Category[]>("/api/v1/categories", { signal });
}

export function createCategory(payload: CategoryPayload, signal?: AbortSignal) {
  return api.post<Category>("/api/v1/categories", payload, { signal });
}

export function updateCategory(
  categoryId: number,
  payload: CategoryPayload,
  signal?: AbortSignal,
) {
  return api.put<Category>(`/api/v1/categories/${categoryId}`, payload, { signal });
}

export function deleteCategory(categoryId: number) {
  return api.delete(`/api/v1/categories/${categoryId}`);
}
