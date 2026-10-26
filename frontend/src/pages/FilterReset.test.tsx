import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import { getCategories } from "../api/categories";
import { getProducts, getProductsCursor } from "../api/products";
import { AuthProvider } from "../auth/AuthContext";
import { CartProvider } from "../cart/CartContext";
import { ToastProvider } from "../components/feedback/Toast";
import { createTestQueryClient, makeCategory, makeList, makeProduct, ok } from "../test/testUtils";
import { ProductsPage } from "./ProductsPage";
import { StorefrontShopPage } from "./StorefrontShopPage";

vi.mock("../api/auth");
vi.mock("../api/categories");
vi.mock("../api/products");

const FULL_FILTERS = "search=phone&category_id=2&min_price=100&max_price=900&sort_by=price&order=asc&page=3";

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="search">{location.search}</p>
      <button onClick={() => navigate(-1)}>history-back</button>
    </>
  );
}

function renderPage(page: "shop" | "admin", entries: string[]) {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>
              {page === "shop" ? <StorefrontShopPage /> : <ProductsPage />}
              <Probe />
            </ToastProvider>
          </CartProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const urlParams = () => new URLSearchParams(screen.getByTestId("search").textContent ?? "");
const settle = (ms = 800) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.getCurrentUser).mockResolvedValue(
    ok({ id: 1, email: "admin@example.com", role: "ADMIN" as const, is_active: true, created_at: "2026-01-01T00:00:00Z" }),
  );
  vi.mocked(getCategories).mockResolvedValue(ok([makeCategory(1, "Phones"), makeCategory(2, "Laptops")]));
  vi.mocked(getProducts).mockResolvedValue(ok(makeList([makeProduct(1, { name: "Item" })], { total: 30, total_pages: 3, page: 3 })));
  vi.mocked(getProductsCursor).mockResolvedValue(ok({ items: [makeProduct(1, { name: "Item" })], next_cursor: null, has_more: false }));
});

describe.each([
  ["storefront shop", "shop", "/shop"],
  ["admin products", "admin", "/admin/products"],
] as const)("Clear filters on the %s", (_name, page, path) => {
  it("resets search, category, price range, sort and page, and the URL matches the controls", async () => {
    renderPage(page, [`${path}?${FULL_FILTERS}`]);
    await screen.findByText("Item");
    expect(screen.getByPlaceholderText("Tìm kiếm sản phẩm")).toHaveValue("phone");

    await userEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    await settle(); // longer than every debounce, so a stale debounced value would have re-applied itself by now

    const params = urlParams();
    for (const key of ["search", "category_id", "min_price", "max_price", "sort_by", "order"]) expect(params.has(key), key).toBe(false);
    expect(params.get("page") ?? "1").toBe("1");
    expect(screen.getByPlaceholderText("Tìm kiếm sản phẩm")).toHaveValue("");
    expect(screen.getByLabelText("Giá thấp nhất")).toHaveValue("");
    expect(screen.getByLabelText("Giá cao nhất")).toHaveValue("");
    expect(screen.getByLabelText("Danh mục")).toHaveValue("");
    expect(screen.getByLabelText(/Sắp xếp/)).toHaveValue("created_at:desc");
    expect(screen.queryByRole("button", { name: "Xóa bộ lọc" })).not.toBeInTheDocument();
  });

  it("only shows the button while at least one filter is on", async () => {
    renderPage(page, [path]);
    await screen.findByText("Item");
    expect(screen.queryByRole("button", { name: "Xóa bộ lọc" })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Danh mục"), "1");
    expect(await screen.findByRole("button", { name: "Xóa bộ lọc" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Xóa bộ lọc" })).not.toBeInTheDocument());
  });

  it("a price typed just before clearing does not come back", async () => {
    renderPage(page, [path]);
    await screen.findByText("Item");
    await userEvent.type(screen.getByLabelText("Giá thấp nhất"), "250");
    await userEvent.click(await screen.findByRole("button", { name: "Xóa bộ lọc" }));
    await settle();

    expect(urlParams().has("min_price")).toBe(false);
    expect(screen.getByLabelText("Giá thấp nhất")).toHaveValue("");
  });

  it("going back in history restores the earlier search instead of re-applying the newer one", async () => {
    renderPage(page, [`${path}?search=a`, `${path}?search=abc`]);
    await screen.findByText("Item");

    await userEvent.click(screen.getByText("history-back"));
    await settle();

    expect(urlParams().get("search")).toBe("a");
    expect(screen.getByPlaceholderText("Tìm kiếm sản phẩm")).toHaveValue("a");
  });
});

describe("storefront: clearing returns the shop to the cursor listing", () => {
  it("drops the non-default sort and the saved page, then loads the first cursor page", async () => {
    renderPage("shop", [`/shop?sort_by=price&order=asc&page=3&search=phone`]);
    await screen.findByText("Item");
    expect(getProductsCursor).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));

    await waitFor(() => expect(getProductsCursor).toHaveBeenCalledWith({ limit: 8, cursor: undefined }, expect.any(AbortSignal)));
  });
});

describe("search boxes have an accessible name", () => {
  it.each([["shop", "/shop"], ["admin", "/admin/products"]] as const)("%s product search", async (page, path) => {
    renderPage(page, [path]);
    await screen.findByText("Item");
    expect(screen.getByRole("textbox", { name: "Tìm kiếm sản phẩm" })).toBeInTheDocument();
  });
});
