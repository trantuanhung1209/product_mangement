import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import { getCategories } from "../api/categories";
import { deleteProduct, getProducts } from "../api/products";
import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../components/feedback/Toast";
import { createTestQueryClient, makeCategory, makeList, makeProduct, ok } from "../test/testUtils";
import { ProductsPage } from "./ProductsPage";

vi.mock("../api/auth");
vi.mock("../api/categories");
vi.mock("../api/products");

const serverError = () => new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, { status: 500 } as AxiosResponse);

function renderPage() {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/products"]}>
        <AuthProvider>
          <ToastProvider>
            <ProductsPage />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.getCurrentUser).mockResolvedValue(
    ok({ id: 1, email: "admin@example.com", role: "ADMIN" as const, is_active: true, created_at: "2026-01-01T00:00:00Z" }),
  );
  vi.mocked(getCategories).mockResolvedValue(ok([makeCategory(1, "Phones"), makeCategory(2, "Laptops")]));
});

describe("ProductsPage", () => {
  it("shows the loading skeleton, then the products with resolved category names", async () => {
    vi.mocked(getProducts).mockResolvedValue(ok(makeList([makeProduct(1, { name: "Alpha" })])));
    renderPage();

    expect(screen.getByLabelText("Đang tải sản phẩm")).toBeInTheDocument();
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByLabelText("Đang tải sản phẩm")).not.toBeInTheDocument();
    expect(await screen.findByText("Phones", { selector: "td" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no products", async () => {
    vi.mocked(getProducts).mockResolvedValue(ok(makeList([])));
    renderPage();
    expect(await screen.findByText("Chưa có sản phẩm nào")).toBeInTheDocument();
  });

  it("shows an error after bounded retries and recovers when the user presses retry", async () => {
    vi.mocked(getProducts).mockRejectedValue(serverError());
    renderPage();
    expect(await screen.findByText("Không thể tải danh sách sản phẩm")).toBeInTheDocument();
    expect(getProducts).toHaveBeenCalledTimes(3);

    vi.mocked(getProducts).mockResolvedValue(ok(makeList([makeProduct(1, { name: "Recovered" })])));
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));

    expect(await screen.findByText("Recovered")).toBeInTheDocument();
    expect(screen.queryByText("Không thể tải danh sách sản phẩm")).not.toBeInTheDocument();
  });

  it("changing the category filter keeps the old rows dimmed and locked until the new result replaces them", async () => {
    let resolveFiltered: (value: ReturnType<typeof ok>) => void = () => {};
    vi.mocked(getProducts).mockImplementation((query) =>
      query.category_id === 2
        ? new Promise((resolve) => { resolveFiltered = resolve as typeof resolveFiltered; })
        : Promise.resolve(ok(makeList([makeProduct(1, { name: "Phone A" })], { total: 30, total_pages: 3 }))),
    );
    renderPage();
    await screen.findByText("Phone A");
    await screen.findByRole("option", { name: "Laptops" });
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeEnabled();

    await userEvent.selectOptions(screen.getByLabelText("Danh mục"), "2");

    // Old rows stay (no blank page) but are marked stale, and paging from them is blocked.
    expect(screen.getByText("Phone A")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Đang cập nhật…");
    expect(screen.getByText("Phone A").closest("[aria-busy='true']")).toHaveClass("is-updating");
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
    expect(screen.queryByLabelText("Đang tải sản phẩm")).not.toBeInTheDocument();
    expect(getProducts).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: 2, page: 1 }), expect.any(AbortSignal));

    resolveFiltered(ok(makeList([makeProduct(5, { name: "Laptop B", category_id: 2 })])));
    expect(await screen.findByText("Laptop B")).toBeInTheDocument();
    expect(screen.queryByText("Phone A")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByText("Laptop B").closest("[aria-busy]")).toHaveAttribute("aria-busy", "false");
  });

  it("deleting a product refetches the list so the deleted row disappears", async () => {
    vi.mocked(getProducts)
      .mockResolvedValueOnce(ok(makeList([makeProduct(1, { name: "Alpha" }), makeProduct(2, { name: "Beta" })])))
      .mockResolvedValue(ok(makeList([makeProduct(2, { name: "Beta" })])));
    vi.mocked(deleteProduct).mockResolvedValue(ok(undefined));
    renderPage();
    await screen.findByText("Alpha");

    await userEvent.click(screen.getByRole("button", { name: "Xóa Alpha" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Xác nhận" }));

    await waitFor(() => expect(screen.queryByText("Alpha")).not.toBeInTheDocument());
    expect(deleteProduct).toHaveBeenCalledWith(1);
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Đã xóa sản phẩm.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a failed delete shows an error, keeps the row and does not refetch or retry", async () => {
    vi.mocked(getProducts).mockResolvedValue(ok(makeList([makeProduct(1, { name: "Alpha" })])));
    vi.mocked(deleteProduct).mockRejectedValue(serverError());
    renderPage();
    await screen.findByText("Alpha");

    await userEvent.click(screen.getByRole("button", { name: "Xóa Alpha" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Xác nhận" }));

    expect(await screen.findByText("Không thể xóa sản phẩm. Vui lòng thử lại.")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(deleteProduct).toHaveBeenCalledTimes(1);
    expect(getProducts).toHaveBeenCalledTimes(1);
  });

  it("disables the confirm button while the delete is pending so it cannot be sent twice", async () => {
    vi.mocked(getProducts).mockResolvedValue(ok(makeList([makeProduct(1, { name: "Alpha" })])));
    let finishDelete: () => void = () => {};
    vi.mocked(deleteProduct).mockImplementation(() => new Promise((resolve) => { finishDelete = () => resolve(ok(undefined)); }));
    renderPage();
    await screen.findByText("Alpha");

    await userEvent.click(screen.getByRole("button", { name: "Xóa Alpha" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Xác nhận" }));

    const pending = await within(screen.getByRole("dialog")).findByRole("button", { name: "Đang xử lý..." });
    expect(pending).toBeDisabled();
    finishDelete();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteProduct).toHaveBeenCalledTimes(1);
  });
});
