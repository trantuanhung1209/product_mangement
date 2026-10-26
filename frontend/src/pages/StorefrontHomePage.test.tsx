import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import * as cartApi from "../api/cart";
import { getCategories } from "../api/categories";
import { getProducts } from "../api/products";
import { AuthProvider } from "../auth/AuthContext";
import { CartProvider } from "../cart/CartContext";
import { ToastProvider } from "../components/feedback/Toast";
import { createTestQueryClient, makeCategory, makeList, makeProduct, ok } from "../test/testUtils";
import { StorefrontHomePage } from "./StorefrontHomePage";

vi.mock("../api/auth");
vi.mock("../api/cart");
vi.mock("../api/categories");
vi.mock("../api/products");

function renderHome() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>
              <StorefrontHomePage />
            </ToastProvider>
          </CartProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.getCurrentUser).mockRejectedValue(new AxiosError("x", "ERR_BAD_REQUEST", undefined, undefined, { status: 401 } as AxiosResponse));
  vi.mocked(cartApi.getCart).mockResolvedValue(ok({ items: [], total_quantity: 0, subtotal: "0" }));
  vi.mocked(getCategories).mockResolvedValue(ok([makeCategory(1, "Phones")]));
});

describe("StorefrontHomePage featured products", () => {
  it("shows an empty state when the catalog has no products", async () => {
    vi.mocked(getProducts).mockResolvedValue(ok(makeList([])));
    renderHome();
    expect(await screen.findByText("Chưa có sản phẩm nào trong catalog.")).toBeInTheDocument();
  });

  it("shows the error state with a retry that recovers", async () => {
    vi.mocked(getProducts)
      .mockRejectedValueOnce(new AxiosError("x", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as AxiosResponse))
      .mockResolvedValue(ok(makeList([makeProduct(1, { name: "Featured one" })])));
    renderHome();
    expect(await screen.findByText("Không thể tải sản phẩm lúc này.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Thử lại" }).click();
    expect((await screen.findAllByText("Featured one")).length).toBeGreaterThan(0);
  });
});
