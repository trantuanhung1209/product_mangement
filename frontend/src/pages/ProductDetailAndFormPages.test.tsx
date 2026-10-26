import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCategories } from "../api/categories";
import { createProduct, deleteProduct, getProduct, updateProduct, uploadProductImage } from "../api/products";
import { productKeys } from "../api/queryKeys";
import { ToastProvider } from "../components/feedback/Toast";
import { createTestQueryClient, makeCategory, makeList, makeProduct, makeQuery, ok } from "../test/testUtils";
import { ProductDetailPage } from "./ProductDetailPage";
import { ProductFormPage } from "./ProductFormPage";

vi.mock("../api/categories");
vi.mock("../api/products");

const notFound = () => new AxiosError("missing", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as AxiosResponse);

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderRoutes(path: string) {
  const client = createTestQueryClient();
  client.setQueryData(productKeys.list(makeQuery()), makeList([makeProduct(1)]));
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/admin/products/new" element={<ProductFormPage mode="create" />} />
            <Route path="/admin/products/:productId/edit" element={<ProductFormPage mode="edit" />} />
            <Route path="/admin/products/:productId" element={<ProductDetailPage />} />
            <Route path="/admin/products" element={<p>list</p>} />
          </Routes>
          <Location />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCategories).mockResolvedValue(ok([makeCategory(1, "Phones")]));
});

describe("ProductDetailPage", () => {
  it("renders the product and its category name from the queries", async () => {
    vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(1, { name: "Alpha" })));
    renderRoutes("/admin/products/1");
    expect(screen.getByText("Đang tải sản phẩm")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Alpha" })).toBeInTheDocument();
    expect(await screen.findByText("Phones")).toBeInTheDocument();
  });

  it("shows not-found for a missing product and does not call the API for an invalid id", async () => {
    vi.mocked(getProduct).mockRejectedValue(notFound());
    renderRoutes("/admin/products/404");
    expect(await screen.findByText("Không tìm thấy sản phẩm")).toBeInTheDocument();
    expect(getProduct).toHaveBeenCalledTimes(1);
  });

  it("a temporary failure offers a retry instead of claiming the product is gone", async () => {
    vi.mocked(getProduct)
      .mockRejectedValue(new AxiosError("down", "ERR_BAD_RESPONSE", undefined, undefined, { status: 503 } as AxiosResponse));
    renderRoutes("/admin/products/1");
    expect(await screen.findByText("Không thể tải sản phẩm")).toBeInTheDocument();
    expect(screen.queryByText("Không tìm thấy sản phẩm")).not.toBeInTheDocument();

    vi.mocked(getProduct).mockReset();
    vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(1, { name: "Back online" })));
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("heading", { name: "Back online" })).toBeInTheDocument();
  });

  it("rejects a non-numeric id without any request", async () => {
    renderRoutes("/admin/products/abc");
    expect(await screen.findByText("Không tìm thấy sản phẩm")).toBeInTheDocument();
    expect(getProduct).not.toHaveBeenCalled();
  });

  it("deleting removes the cached detail, invalidates lists and returns to the list", async () => {
    vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(1, { name: "Alpha" })));
    vi.mocked(deleteProduct).mockResolvedValue(ok(undefined));
    const client = renderRoutes("/admin/products/1");
    await screen.findByRole("heading", { name: "Alpha" });

    await userEvent.click(screen.getByRole("button", { name: /Xóa sản phẩm/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Xác nhận" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/products"));
    expect(client.getQueryData(productKeys.detail(1))).toBeUndefined();
    expect(client.getQueryState(productKeys.list(makeQuery()))?.isInvalidated).toBe(true);
    // The mounted page must not refetch the product it just deleted (that would be a 404).
    expect(getProduct).toHaveBeenCalledTimes(1);
  });
});

describe("ProductFormPage", () => {
  it("create: submits once, invalidates lists and goes to the new product", async () => {
    vi.mocked(createProduct).mockResolvedValue(ok(makeProduct(9, { name: "Brand new" })));
    const client = renderRoutes("/admin/products/new");
    await screen.findByRole("option", { name: "Phones" });

    await userEvent.type(screen.getByLabelText(/Tên sản phẩm/), "Brand new");
    await userEvent.type(screen.getByLabelText(/Giá bán/), "1500");
    await userEvent.selectOptions(screen.getByLabelText(/Danh mục/), "1");
    await userEvent.click(screen.getByRole("button", { name: "Thêm sản phẩm" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/products/9"));
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(createProduct).toHaveBeenCalledWith(expect.objectContaining({ name: "Brand new", price: "1500", category_id: 1 }), expect.any(AbortSignal));
    expect(client.getQueryState(productKeys.list(makeQuery()))?.isInvalidated).toBe(true);
    expect(client.getQueryData(productKeys.detail(9))).toMatchObject({ name: "Brand new" });
  });

  it("edit: loads the product from the server, saves with PUT and updates the detail cache", async () => {
    vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(1, { name: "Alpha" })));
    vi.mocked(updateProduct).mockResolvedValue(ok(makeProduct(1, { name: "Alpha 2" })));
    const client = renderRoutes("/admin/products/1/edit");
    const name = await screen.findByLabelText(/Tên sản phẩm/);
    expect(name).toHaveValue("Alpha");

    await userEvent.type(name, " 2");
    await userEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/products/1"));
    expect(updateProduct).toHaveBeenCalledWith(1, expect.objectContaining({ name: "Alpha 2" }), expect.any(AbortSignal));
    expect(client.getQueryData(productKeys.detail(1))).toMatchObject({ name: "Alpha 2" });
  });

  it("shows an error message and re-enables the submit button when saving fails", async () => {
    vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(1, { name: "Alpha" })));
    vi.mocked(updateProduct).mockRejectedValue(new AxiosError("boom", "ERR_BAD_RESPONSE", undefined, undefined, { status: 500 } as AxiosResponse));
    renderRoutes("/admin/products/1/edit");
    await screen.findByLabelText(/Tên sản phẩm/);

    await userEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Không thể lưu sản phẩm");
    expect(screen.getByRole("button", { name: "Lưu thay đổi" })).toBeEnabled();
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/admin/products/1/edit");
  });

  it("create + failed image upload + save again updates the created product instead of creating a duplicate", async () => {
    vi.mocked(createProduct).mockResolvedValue(ok(makeProduct(9, { name: "Brand new" })));
    vi.mocked(updateProduct).mockResolvedValue(ok(makeProduct(9, { name: "Brand new" })));
    vi.mocked(uploadProductImage)
      .mockRejectedValueOnce(new AxiosError("boom", "ERR_BAD_RESPONSE", undefined, undefined, { status: 500 } as AxiosResponse))
      .mockResolvedValueOnce(ok(makeProduct(9, { image_url: "/img/9" })));
    const client = renderRoutes("/admin/products/new");
    await screen.findByRole("option", { name: "Phones" });
    await userEvent.type(screen.getByLabelText(/Tên sản phẩm/), "Brand new");
    await userEvent.type(screen.getByLabelText(/Giá bán/), "1500");
    await userEvent.selectOptions(screen.getByLabelText(/Danh mục/), "1");
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, new File(["x"], "a.png", { type: "image/png" }));

    await userEvent.click(screen.getByRole("button", { name: "Thêm sản phẩm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không thể lưu sản phẩm");
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(productKeys.list(makeQuery()))?.isInvalidated).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Thêm sản phẩm" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/products/9"));
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct).toHaveBeenCalledWith(9, expect.objectContaining({ name: "Brand new" }), expect.any(AbortSignal));
    expect(uploadProductImage).toHaveBeenCalledTimes(2);
    expect(uploadProductImage).toHaveBeenLastCalledWith(9, expect.any(File), expect.any(AbortSignal));
  });

  it("edit: a missing product says so without offering a retry", async () => {
    vi.mocked(getProduct).mockRejectedValue(notFound());
    renderRoutes("/admin/products/404/edit");
    expect(await screen.findByText("Không tìm thấy sản phẩm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
  });

  it("edit: a temporary failure offers a retry that loads the form", async () => {
    vi.mocked(getProduct).mockRejectedValue(new AxiosError("down", "ERR_BAD_RESPONSE", undefined, undefined, { status: 503 } as AxiosResponse));
    renderRoutes("/admin/products/1/edit");
    expect(await screen.findByText("Không thể tải dữ liệu sản phẩm")).toBeInTheDocument();
    expect(screen.queryByText("Không tìm thấy sản phẩm")).not.toBeInTheDocument();

    vi.mocked(getProduct).mockReset();
    vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(1, { name: "Loaded after retry" })));
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByLabelText(/Tên sản phẩm/)).toHaveValue("Loaded after retry");
  });

  it("create: a categories failure offers a retry that loads the form", async () => {
    vi.mocked(getCategories).mockReset();
    vi.mocked(getCategories).mockRejectedValueOnce(notFound()).mockResolvedValue(ok([makeCategory(1, "Phones")]));
    renderRoutes("/admin/products/new");
    expect(await screen.findByText("Không thể tải dữ liệu sản phẩm")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("option", { name: "Phones" })).toBeInTheDocument();
  });
});
