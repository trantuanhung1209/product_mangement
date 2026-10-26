import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import * as cartApi from "../api/cart";
import { getCategories } from "../api/categories";
import { getProducts } from "../api/products";
import { AuthProvider } from "../auth/AuthContext";
import { CartProvider } from "../cart/CartContext";
import { ToastProvider } from "../components/feedback/Toast";
import { createTestQueryClient, makeCategory, makeList, makeProduct, ok } from "../test/testUtils";
import { ProductsPage } from "./ProductsPage";
import { StorefrontShopPage } from "./StorefrontShopPage";

vi.mock("../api/auth");
vi.mock("../api/cart");
vi.mock("../api/categories");
vi.mock("../api/products");

const scrollIntoView = vi.fn();

function renderPage(page: "shop" | "admin", path: string) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>{page === "shop" ? <StorefrontShopPage /> : <ProductsPage />}</ToastProvider>
          </CartProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.mocked(authApi.getCurrentUser).mockResolvedValue(
    ok({ id: 1, email: "admin@example.com", role: "ADMIN" as const, is_active: true, created_at: "2026-01-01T00:00:00Z" }),
  );
  vi.mocked(cartApi.getCart).mockResolvedValue(ok({ items: [], total_quantity: 0, subtotal: "0" }));
  vi.mocked(getCategories).mockResolvedValue(ok([makeCategory(1, "Phones")]));
  vi.mocked(getProducts).mockImplementation(async (query) =>
    ok(makeList([makeProduct(query.page, { name: `Item on page ${query.page}` })], { total: 30, page: query.page, page_size: 8, total_pages: 3 })),
  );
});
afterEach(() => {
  // @ts-expect-error restore jsdom's lack of scrollIntoView
  delete Element.prototype.scrollIntoView;
});

describe.each([
  ["admin products", "admin", "/admin/products", "Trang sau"],
  ["storefront shop (offset sort)", "shop", "/shop?sort_by=price&order=asc", "Trang sau"],
] as const)("%s", (_name, page, path, nextLabel) => {
  it("scrolls the list into view when the page changes, but not on first load", async () => {
    renderPage(page, path);
    await screen.findByText("Item on page 1");
    expect(scrollIntoView).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: nextLabel }));
    await screen.findByText("Item on page 2");

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  });

  it("jumps without animation when the user prefers reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    renderPage(page, path);
    await screen.findByText("Item on page 1");

    await userEvent.click(screen.getByRole("button", { name: nextLabel }));
    await screen.findByText("Item on page 2");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    vi.unstubAllGlobals();
  });
});

describe("storefront cursor mode", () => {
  it("does not scroll when more products are loaded", async () => {
    const { getProductsCursor } = await import("../api/products");
    vi.mocked(getProductsCursor)
      .mockResolvedValueOnce(ok({ items: [makeProduct(1, { name: "First" })], next_cursor: "c1", has_more: true }))
      .mockResolvedValueOnce(ok({ items: [makeProduct(2, { name: "Second" })], next_cursor: null, has_more: false }));
    renderPage("shop", "/shop");
    await screen.findByText("First");

    await userEvent.click(screen.getByRole("button", { name: "Tải thêm sản phẩm" }));
    await screen.findByText("Second");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
