import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "./api/auth";
import * as cartApi from "./api/cart";
import { getCategories } from "./api/categories";
import { getProduct, getProducts, getProductsCursor } from "./api/products";
import { App } from "./App";
import { createTestQueryClient, makeCategory, makeList, makeProduct, ok } from "./test/testUtils";

vi.mock("lenis", () => ({ default: class { destroy() {} } }));
vi.mock("./api/auth");
vi.mock("./api/cart");
vi.mock("./api/categories");
vi.mock("./api/products");

const admin = { id: 1, email: "admin@example.com", role: "ADMIN" as const, is_active: true, created_at: "2026-01-01T00:00:00Z" };

function renderAt(path: string, signedIn = true) {
  if (signedIn) vi.mocked(authApi.getCurrentUser).mockResolvedValue(ok(admin));
  else vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error("anonymous"));
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  document.title = "";
  vi.mocked(getProducts).mockResolvedValue(ok(makeList([makeProduct(1)])));
  vi.mocked(getProductsCursor).mockResolvedValue(ok({ items: [makeProduct(1)], next_cursor: null, has_more: false }));
  vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(1, { name: "Bàn phím cơ" })));
  vi.mocked(getCategories).mockResolvedValue(ok([makeCategory(1)]));
  vi.mocked(cartApi.getCart).mockResolvedValue(ok({ items: [], total_quantity: 0, subtotal: "0" }));
  vi.mocked(authApi.getSessions).mockResolvedValue(ok([]));
  vi.mocked(authApi.getAdminUsers).mockResolvedValue(ok({ items: [], total: 0, page: 1, page_size: 20, total_pages: 0 }));
});

describe("document title", () => {
  it.each([
    ["/", true, "Trang chủ · Product Catalog"],
    ["/shop", true, "Sản phẩm · Product Catalog"],
    ["/cart", true, "Giỏ hàng · Product Catalog"],
    ["/login", false, "Đăng nhập · Product Catalog"],
    ["/admin/products", true, "Quản lý sản phẩm · Product Catalog"],
    ["/admin/products/new", true, "Thêm sản phẩm · Product Catalog"],
    ["/admin/categories", true, "Danh mục · Product Catalog"],
    ["/admin/categories/new", true, "Thêm danh mục · Product Catalog"],
    ["/admin/users", true, "Quản lý người dùng · Product Catalog"],
    ["/account/sessions", true, "Phiên đăng nhập · Product Catalog"],
    ["/this/does/not/exist", true, "Không tìm thấy trang · Product Catalog"],
  ])("%s sets the title", async (path, signedIn, title) => {
    renderAt(path, signedIn);
    await waitFor(() => expect(document.title).toBe(title));
  });

  it("uses the product name once the product has loaded", async () => {
    renderAt("/shop/1");
    await waitFor(() => expect(document.title).toBe("Bàn phím cơ · Product Catalog"));
    expect(await screen.findByRole("heading", { name: "Bàn phím cơ" })).toBeInTheDocument();
  });

  it("uses the product name on the admin detail page too", async () => {
    renderAt("/admin/products/1");
    await waitFor(() => expect(document.title).toBe("Bàn phím cơ · Product Catalog"));
  });
});

describe("page chrome", () => {
  it("the admin layout has a skip link that targets the main landmark", async () => {
    renderAt("/admin/products");
    const skip = await screen.findByRole("link", { name: "Bỏ qua điều hướng" });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("the unknown-route page offers a way back to the shop", async () => {
    renderAt("/nope");
    expect(await screen.findByRole("heading", { name: "Không tìm thấy trang" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Về cửa hàng/ })).toHaveAttribute("href", "/shop");
  });
});
