import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import * as cartApi from "../api/cart";
import { getCategories } from "../api/categories";
import { getProduct } from "../api/products";
import { AuthProvider } from "../auth/AuthContext";
import { CartProvider } from "../cart/CartContext";
import { StoreProductCard } from "../components/storefront/StoreProductCard";
import { ToastProvider } from "../components/feedback/Toast";
import { createTestQueryClient, makeCategory, makeProduct, ok } from "../test/testUtils";
import type { AuthUser, Cart } from "../types/catalog";
import { defaultProductImage } from "../utils/defaultProductImage";
import { CartPage } from "./CartPage";
import { StorefrontProductPage } from "./StorefrontProductPage";

vi.mock("../api/auth");
vi.mock("../api/cart");
vi.mock("../api/categories");
vi.mock("../api/products");

const me: AuthUser = { id: 3, email: "me@example.com", role: "USER", is_active: true, created_at: "2026-01-01T00:00:00Z" };
const unauthorized = new AxiosError("failed", "ERR_BAD_REQUEST", undefined, undefined, { status: 401 } as AxiosResponse);
const emptyCart: Cart = { items: [], total_quantity: 0, subtotal: "0" };

function renderAt(path: string, element: React.ReactNode) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>
              <Routes>
                <Route path="/shop/:productId" element={element} />
                <Route path="/cart" element={element} />
                <Route path="/card" element={element} />
              </Routes>
            </ToastProvider>
          </CartProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.getCurrentUser).mockRejectedValue(unauthorized);
  vi.mocked(cartApi.getCart).mockResolvedValue(ok(emptyCart));
  vi.mocked(getCategories).mockResolvedValue(ok([makeCategory(1, "Phones")]));
});

describe("default product image", () => {
  it("shows a default image on a storefront card when the product has no photo", () => {
    renderAt("/card", <StoreProductCard product={makeProduct(8, { name: "Plain mug" })} />);
    const image = screen.getByRole("img", { name: "Plain mug" });
    expect(image).toHaveAttribute("src", defaultProductImage(8));
    expect(image).toHaveAttribute("data-default-image", "true");
    expect(screen.queryByText("Chưa có ảnh")).not.toBeInTheDocument();
  });

  it("keeps the real photo on a card when there is one", () => {
    renderAt("/card", <StoreProductCard product={makeProduct(7, { name: "Real mug", image_url: "/api/v1/products/7/image" })} />);
    const image = screen.getByRole("img", { name: "Real mug" });
    expect(image.getAttribute("src")).toContain("/api/v1/products/7/image");
    expect(image).not.toHaveAttribute("data-default-image");
  });

  it("shows a default image on the product page", async () => {
    vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(5, { name: "Plain lamp" })));
    renderAt("/shop/5", <StorefrontProductPage />);
    const image = await screen.findByRole("img", { name: "Plain lamp" });
    expect(image).toHaveAttribute("src", defaultProductImage(5));
  });

  it("shows a default image for a cart line without a photo", async () => {
    vi.mocked(authApi.getCurrentUser).mockResolvedValue(ok(me));
    vi.mocked(cartApi.getCart).mockResolvedValue(
      ok({
        items: [{ product_id: 10, name: "Plain cup", image_url: null, unit_price: "1000", quantity: 1, line_total: "1000", available_stock: 5, is_available: true }],
        total_quantity: 1,
        subtotal: "1000",
      }),
    );
    renderAt("/cart", <CartPage />);
    const image = await screen.findByRole("img", { name: "Plain cup" });
    expect(image).toHaveAttribute("src", defaultProductImage(10));
  });
});
