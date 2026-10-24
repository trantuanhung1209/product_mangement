import { api } from "./client";
import type { Cart } from "../types/catalog";

export function getCart(signal?: AbortSignal) {
  return api.get<Cart>("/api/v1/cart", { signal });
}

export function addCartItem(productId: number, quantity: number) {
  return api.post<Cart>("/api/v1/cart/items", {
    product_id: productId,
    quantity,
  });
}

export function updateCartItem(productId: number, quantity: number) {
  return api.patch<Cart>(`/api/v1/cart/items/${productId}`, { quantity });
}

export function removeCartItem(productId: number) {
  return api.delete(`/api/v1/cart/items/${productId}`);
}

export function clearCart() {
  return api.delete("/api/v1/cart");
}
