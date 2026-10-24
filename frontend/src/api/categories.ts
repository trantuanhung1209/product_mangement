import { api } from "./client";
import type { Category } from "../types/catalog";

export function getCategories(signal: AbortSignal) {
  return api.get<Category[]>("/api/v1/categories", { signal });
}
