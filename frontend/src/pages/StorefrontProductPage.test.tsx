import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import * as cartApi from "../api/cart";
import { getCategories } from "../api/categories";
import { getProduct } from "../api/products";
import { AuthProvider } from "../auth/AuthContext";
import { CartProvider } from "../cart/CartContext";
import { ToastProvider } from "../components/feedback/Toast";
import { createTestQueryClient, makeCategory, makeProduct, ok } from "../test/testUtils";
import { StorefrontProductPage } from "./StorefrontProductPage";

vi.mock("../api/auth");
vi.mock("../api/cart");
vi.mock("../api/categories");
vi.mock("../api/products");

const httpError = (status: number) => new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, { status } as AxiosResponse);

function renderPage(path = "/shop/1") {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>
              <Routes>
                <Route path="/shop/:productId" element={<StorefrontProductPage />} />
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
  vi.mocked(authApi.getCurrentUser).mockRejectedValue(httpError(401));
  vi.mocked(cartApi.getCart).mockResolvedValue(ok({ items: [], total_quantity: 0, subtotal: "0" }));
  vi.mocked(getCategories).mockResolvedValue(ok([makeCategory(1, "Phones")]));
});

describe("StorefrontProductPage", () => {
  it("shows the product and sets the tab title to its name", async () => {
    vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(1, { name: "Alpha phone" })));
    renderPage();
    expect(await screen.findByRole("heading", { name: "Alpha phone" })).toBeInTheDocument();
    expect(document.title).toBe("Alpha phone · Product Catalog");
  });

  it("a missing product says so, and does not offer a pointless retry", async () => {
    vi.mocked(getProduct).mockRejectedValue(httpError(404));
    renderPage();
    expect(await screen.findByRole("heading", { name: "Không tìm thấy sản phẩm" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
    expect(getProduct).toHaveBeenCalledTimes(1);
  });

  it("a malformed id is treated as not found without calling the API", async () => {
    renderPage("/shop/abc");
    expect(await screen.findByRole("heading", { name: "Không tìm thấy sản phẩm" })).toBeInTheDocument();
    expect(getProduct).not.toHaveBeenCalled();
  });

  it("a server or network failure offers a retry instead of saying the product is gone", async () => {
    vi.mocked(getProduct).mockRejectedValue(httpError(503));
    renderPage();
    expect(await screen.findByRole("heading", { name: "Không thể tải sản phẩm" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Không tìm thấy sản phẩm" })).not.toBeInTheDocument();

    vi.mocked(getProduct).mockReset();
    vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(1, { name: "Recovered" })));
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("heading", { name: "Recovered" })).toBeInTheDocument();
  });
});
