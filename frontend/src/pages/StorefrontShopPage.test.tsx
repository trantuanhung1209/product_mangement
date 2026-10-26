import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import { getCategories } from "../api/categories";
import { getProducts, getProductsCursor } from "../api/products";
import { AuthProvider } from "../auth/AuthContext";
import { CartProvider } from "../cart/CartContext";
import { ToastProvider } from "../components/feedback/Toast";
import { createTestQueryClient, makeCategory, makeList, makeProduct, ok } from "../test/testUtils";
import type { ProductCursorResponse } from "../types/catalog";
import { StorefrontShopPage } from "./StorefrontShopPage";

vi.mock("../api/auth");
vi.mock("../api/categories");
vi.mock("../api/products");

const cursorPage = (names: string[], next: string | null, startId = 1): ProductCursorResponse => ({
  items: names.map((name, index) => makeProduct(startId + index, { name })),
  next_cursor: next,
  has_more: next !== null,
});
const httpError = (status: number) => new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, { status } as AxiosResponse);

function Search() {
  return <p data-testid="search">{useLocation().search}</p>;
}

function renderShop(path = "/shop") {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>
              <StorefrontShopPage />
              <Search />
            </ToastProvider>
          </CartProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.getCurrentUser).mockRejectedValue(httpError(401)); // anonymous visitor
  vi.mocked(getCategories).mockResolvedValue(ok([makeCategory(1, "Phones"), makeCategory(2, "Laptops")]));
});

describe("StorefrontShopPage: default order uses the cursor API", () => {
  it("loads the first page, appends the next one with the server's cursor, then reports the end", async () => {
    vi.mocked(getProductsCursor)
      .mockResolvedValueOnce(ok(cursorPage(["Alpha", "Beta"], "cursor-1")))
      .mockResolvedValueOnce(ok(cursorPage(["Gamma"], null, 3)));
    renderShop();

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(getProductsCursor).toHaveBeenCalledWith({ limit: 8, cursor: undefined }, expect.any(AbortSignal));
    expect(getProducts).not.toHaveBeenCalled();
    expect(screen.getByText("Đang hiển thị 2 sản phẩm")).toBeInTheDocument();
    expect(screen.queryByLabelText("Phân trang")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Tải thêm sản phẩm" }));

    expect(await screen.findByText("Gamma")).toBeInTheDocument();
    expect(getProductsCursor).toHaveBeenLastCalledWith({ limit: 8, cursor: "cursor-1" }, expect.any(AbortSignal));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Đang hiển thị 3 sản phẩm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải thêm sản phẩm" })).not.toBeInTheDocument();
    expect(screen.getByText("Đã hiển thị tất cả sản phẩm")).toBeInTheDocument();
  });

  it("changing a filter restarts from the first page and never keeps the old rows", async () => {
    vi.mocked(getProductsCursor).mockImplementation(async (params) =>
      ok(params.category_id === 2 ? cursorPage(["Laptop X"], null, 10) : cursorPage(["Phone A"], "cursor-1")),
    );
    renderShop();
    await screen.findByText("Phone A");
    await screen.findByRole("option", { name: "Laptops" });

    await userEvent.selectOptions(screen.getByLabelText("Danh mục"), "2");

    expect(await screen.findByText("Laptop X")).toBeInTheDocument();
    expect(screen.queryByText("Phone A")).not.toBeInTheDocument();
    expect(getProductsCursor).toHaveBeenLastCalledWith({ limit: 8, category_id: 2, cursor: undefined }, expect.any(AbortSignal));
  });

  it("a failed 'load more' keeps the rows on screen and retrying asks for the same cursor", async () => {
    vi.mocked(getProductsCursor)
      .mockResolvedValueOnce(ok(cursorPage(["Alpha"], "cursor-1")))
      .mockRejectedValueOnce(httpError(400))
      .mockResolvedValueOnce(ok(cursorPage(["Beta"], null, 2)));
    renderShop();
    await screen.findByText("Alpha");

    await userEvent.click(screen.getByRole("button", { name: "Tải thêm sản phẩm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không thể tải thêm sản phẩm.");
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(getProductsCursor).toHaveBeenLastCalledWith({ limit: 8, cursor: "cursor-1" }, expect.any(AbortSignal));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the button while the next page is loading, so a click cannot request it twice", async () => {
    let finish: (value: ReturnType<typeof ok<ProductCursorResponse>>) => void = () => {};
    vi.mocked(getProductsCursor)
      .mockResolvedValueOnce(ok(cursorPage(["Alpha"], "cursor-1")))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as typeof finish; }));
    renderShop();
    await screen.findByText("Alpha");

    await userEvent.click(screen.getByRole("button", { name: "Tải thêm sản phẩm" }));
    const busy = await screen.findByRole("button", { name: "Đang tải..." });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    finish(ok(cursorPage(["Beta"], null, 2)));

    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(getProductsCursor).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state, and the error state with retry for the first page", async () => {
    vi.mocked(getProductsCursor).mockResolvedValueOnce(ok(cursorPage([], null)));
    renderShop();
    expect(await screen.findByText("Chưa tìm thấy sản phẩm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải thêm sản phẩm" })).not.toBeInTheDocument();
  });

  it("first-page failure shows the catalog error and recovers on retry", async () => {
    vi.mocked(getProductsCursor).mockRejectedValueOnce(httpError(404)).mockResolvedValueOnce(ok(cursorPage(["Recovered"], null)));
    renderShop();
    expect(await screen.findByText(/Không thể tải catalog/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Recovered")).toBeInTheDocument();
  });
});

describe("StorefrontShopPage: other sort orders keep the offset API and page numbers", () => {
  it("a non-default sort in the URL uses /products with totals and numbered pages", async () => {
    vi.mocked(getProducts).mockResolvedValue(ok(makeList([makeProduct(1, { name: "Cheap" })], { total: 17, page: 1, page_size: 8, total_pages: 3 })));
    renderShop("/shop?sort_by=price&order=asc");

    expect(await screen.findByText("Cheap")).toBeInTheDocument();
    expect(getProductsCursor).not.toHaveBeenCalled();
    expect(getProducts).toHaveBeenCalledWith(expect.objectContaining({ sort_by: "price", order: "asc", page: 1, page_size: 8 }), expect.any(AbortSignal));
    expect(screen.getByText("17 sản phẩm")).toBeInTheDocument();
    expect(screen.getByText("Trang 1 / 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải thêm sản phẩm" })).not.toBeInTheDocument();

    vi.mocked(getProducts).mockResolvedValue(ok(makeList([makeProduct(9, { name: "Page two" })], { total: 17, page: 2, page_size: 8, total_pages: 3 })));
    await userEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    expect(await screen.findByText("Page two")).toBeInTheDocument();
    expect(getProducts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.any(AbortSignal));
  });

  it("picking another sort switches to the offset API and picking newest switches back to the cursor API", async () => {
    vi.mocked(getProductsCursor).mockResolvedValue(ok(cursorPage(["Newest"], null)));
    vi.mocked(getProducts).mockResolvedValue(ok(makeList([makeProduct(5, { name: "By price" })], { total: 1, total_pages: 1 })));
    renderShop();
    await screen.findByText("Newest");
    expect(getProducts).not.toHaveBeenCalled();

    const sort = screen.getByLabelText(/Sắp xếp/);
    await userEvent.selectOptions(sort, "price:asc");
    expect(await screen.findByText("By price")).toBeInTheDocument();
    expect(screen.getByTestId("search")).toHaveTextContent("sort_by=price");

    await userEvent.selectOptions(sort, "created_at:desc");
    expect(await screen.findByText("Newest")).toBeInTheDocument();
    expect(screen.queryByText("By price")).not.toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Tải thêm sản phẩm" })).getByText("Đã hiển thị tất cả sản phẩm")).toBeInTheDocument());
  });
});
