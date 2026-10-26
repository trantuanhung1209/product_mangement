import { renderHook, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { categoryKeys, productKeys } from "../api/queryKeys";
import { createProduct, deleteProduct, updateProduct, uploadProductImage } from "../api/products";
import { createTestQueryClient, makeCategory, makeList, makeProduct, makeQuery, ok, queryWrapper } from "../test/testUtils";
import { useDeleteProduct, useSaveProduct } from "./useProductMutations";

vi.mock("../api/products");

const serverError = () => new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, { status: 500 } as AxiosResponse);
const payload = { name: "P", description: null, price: "1", stock: 1, category_id: 1, image_url: null };

function seededClient() {
  const client = createTestQueryClient();
  client.setQueryData(productKeys.list(makeQuery()), makeList([makeProduct(1), makeProduct(2)]));
  client.setQueryData(productKeys.list(makeQuery({ search: "x" })), makeList([makeProduct(1)]));
  client.setQueryData(productKeys.detail(1), makeProduct(1));
  client.setQueryData(productKeys.detail(2), makeProduct(2));
  client.setQueryData(categoryKeys.lists(), [makeCategory(1)]);
  return client;
}
const invalidated = (client: ReturnType<typeof seededClient>, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated;

beforeEach(() => vi.resetAllMocks());

describe("useSaveProduct", () => {
  it("create: invalidates every list, caches the new detail and leaves other caches alone", async () => {
    const client = seededClient();
    vi.mocked(createProduct).mockResolvedValue(ok(makeProduct(3, { name: "Created" })));
    const { result } = renderHook(() => useSaveProduct(), { wrapper: queryWrapper(client) });

    const saved = await result.current.mutateAsync({ payload, file: null });

    expect(saved.id).toBe(3);
    expect(invalidated(client, productKeys.list(makeQuery()))).toBe(true);
    expect(invalidated(client, productKeys.list(makeQuery({ search: "x" })))).toBe(true);
    expect(client.getQueryData(productKeys.detail(3))).toMatchObject({ name: "Created" });
    expect(invalidated(client, productKeys.detail(1))).toBe(false);
    expect(invalidated(client, categoryKeys.lists())).toBe(false);
  });

  it("update: stores the server response in the detail cache and invalidates lists", async () => {
    const client = seededClient();
    vi.mocked(updateProduct).mockResolvedValue(ok(makeProduct(1, { name: "Renamed" })));
    const { result } = renderHook(() => useSaveProduct(1), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync({ payload, file: null });

    expect(updateProduct).toHaveBeenCalledWith(1, payload, undefined);
    expect(client.getQueryData(productKeys.detail(1))).toMatchObject({ name: "Renamed" });
    expect(invalidated(client, productKeys.list(makeQuery()))).toBe(true);
    expect(invalidated(client, productKeys.detail(2))).toBe(false);
  });

  it("uploads the image after saving and caches the product returned by the upload", async () => {
    const client = seededClient();
    const file = new File(["x"], "a.png", { type: "image/png" });
    vi.mocked(createProduct).mockResolvedValue(ok(makeProduct(3)));
    vi.mocked(uploadProductImage).mockResolvedValue(ok(makeProduct(3, { image_url: "/img/3" })));
    const { result } = renderHook(() => useSaveProduct(), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync({ payload, file });

    expect(uploadProductImage).toHaveBeenCalledWith(3, file, undefined);
    expect(client.getQueryData(productKeys.detail(3))).toMatchObject({ image_url: "/img/3" });
  });

  it("create with failed upload still invalidates lists (the product exists) and is not retried", async () => {
    const client = seededClient();
    vi.mocked(createProduct).mockResolvedValue(ok(makeProduct(3)));
    vi.mocked(uploadProductImage).mockRejectedValue(serverError());
    const { result } = renderHook(() => useSaveProduct(), { wrapper: queryWrapper(client) });

    await expect(result.current.mutateAsync({ payload, file: new File(["x"], "a.png") })).rejects.toBeTruthy();

    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(invalidated(client, productKeys.list(makeQuery()))).toBe(true);
  });

  it("failed update invalidates the detail and is not retried", async () => {
    const client = seededClient();
    vi.mocked(updateProduct).mockRejectedValue(serverError());
    const { result } = renderHook(() => useSaveProduct(1), { wrapper: queryWrapper(client) });

    await expect(result.current.mutateAsync({ payload, file: null })).rejects.toBeTruthy();

    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(invalidated(client, productKeys.detail(1))).toBe(true);
    expect(invalidated(client, productKeys.detail(2))).toBe(false);
  });
});

describe("useDeleteProduct", () => {
  it("removes the deleted detail, invalidates lists and keeps other details", async () => {
    const client = seededClient();
    vi.mocked(deleteProduct).mockResolvedValue(ok(undefined));
    const { result } = renderHook(() => useDeleteProduct(), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync(1);

    await waitFor(() => expect(invalidated(client, productKeys.list(makeQuery()))).toBe(true));
    expect(client.getQueryData(productKeys.detail(1))).toBeUndefined();
    expect(client.getQueryData(productKeys.detail(2))).toBeDefined();
    expect(invalidated(client, categoryKeys.lists())).toBe(false);
  });

  it("leaves every cache untouched when the delete fails, and does not retry", async () => {
    const client = seededClient();
    vi.mocked(deleteProduct).mockRejectedValue(serverError());
    const { result } = renderHook(() => useDeleteProduct(), { wrapper: queryWrapper(client) });

    await expect(result.current.mutateAsync(1)).rejects.toBeTruthy();

    expect(deleteProduct).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(productKeys.detail(1))).toBeDefined();
    expect(invalidated(client, productKeys.list(makeQuery()))).toBe(false);
  });
});
