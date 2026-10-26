import { renderHook, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getProduct, getProducts } from "../api/products";
import { createTestQueryClient, makeList, makeProduct, makeQuery, ok, queryWrapper } from "../test/testUtils";
import { useProduct } from "./useProduct";
import { useProducts } from "./useProducts";

vi.mock("../api/products");

const httpError = (status: number) =>
  new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, { status } as AxiosResponse);

beforeEach(() => vi.resetAllMocks());

describe("useProducts", () => {
  it("calls the API with the query and an abort signal, then exposes the data", async () => {
    const list = makeList([makeProduct(1)]);
    vi.mocked(getProducts).mockResolvedValue(ok(list));
    const query = makeQuery({ search: "phone", category_id: 2 });
    const { result } = renderHook(() => useProducts(query), { wrapper: queryWrapper(createTestQueryClient()) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual(list));
    expect(getProducts).toHaveBeenCalledTimes(1);
    expect(getProducts).toHaveBeenCalledWith(query, expect.any(AbortSignal));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it("keeps the previous result on screen, flagged as updating, while a new filter loads, then swaps it", async () => {
    const all = makeList([makeProduct(1), makeProduct(2)]);
    const filtered = makeList([makeProduct(3)]);
    let resolveFiltered: (value: ReturnType<typeof ok>) => void = () => {};
    vi.mocked(getProducts).mockImplementation((query) =>
      query.category_id === 9
        ? new Promise((resolve) => { resolveFiltered = resolve as typeof resolveFiltered; })
        : Promise.resolve(ok(all)),
    );
    const { result, rerender } = renderHook(({ query }) => useProducts(query), {
      initialProps: { query: makeQuery() },
      wrapper: queryWrapper(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current.data).toEqual(all));
    expect(result.current.updating).toBe(false);

    rerender({ query: makeQuery({ category_id: 9 }) });
    expect(result.current.data).toEqual(all); // stale, but the page does not blank out
    expect(result.current.updating).toBe(true); // callers must mark it as stale
    expect(result.current.loading).toBe(false);

    resolveFiltered(ok(filtered));
    await waitFor(() => expect(result.current.data).toEqual(filtered));
    expect(result.current.updating).toBe(false);

    rerender({ query: makeQuery() });
    expect(result.current.data).toEqual(all);
    expect(result.current.updating).toBe(false); // served from cache
    expect(getProducts).toHaveBeenCalledTimes(2);
  });

  it("drops the stale result and reports the error when the new filter fails", async () => {
    const all = makeList([makeProduct(1)]);
    vi.mocked(getProducts).mockImplementation((query) =>
      query.category_id === 9 ? Promise.reject(httpError(404)) : Promise.resolve(ok(all)),
    );
    const { result, rerender } = renderHook(({ query }) => useProducts(query), {
      initialProps: { query: makeQuery() },
      wrapper: queryWrapper(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current.data).toEqual(all));

    rerender({ query: makeQuery({ category_id: 9 }) });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.updating).toBe(false);
  });

  it("retries transient failures a bounded number of times", async () => {
    vi.mocked(getProducts).mockRejectedValue(httpError(500));
    const { result } = renderHook(() => useProducts(makeQuery()), { wrapper: queryWrapper(createTestQueryClient()) });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(getProducts).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors and recovers through retry()", async () => {
    vi.mocked(getProducts).mockRejectedValueOnce(httpError(404));
    const list = makeList([makeProduct(1)]);
    vi.mocked(getProducts).mockResolvedValueOnce(ok(list));
    const { result } = renderHook(() => useProducts(makeQuery()), { wrapper: queryWrapper(createTestQueryClient()) });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(getProducts).toHaveBeenCalledTimes(1);

    result.current.retry();
    await waitFor(() => expect(result.current.data).toEqual(list));
    expect(result.current.error).toBe(false);
  });
});

describe("useProduct", () => {
  it("fetches by id and does not call the API for an invalid id", async () => {
    vi.mocked(getProduct).mockResolvedValue(ok(makeProduct(7)));
    const { result } = renderHook(() => useProduct(7), { wrapper: queryWrapper(createTestQueryClient()) });
    await waitFor(() => expect(result.current.product?.id).toBe(7));
    expect(getProduct).toHaveBeenCalledWith(7, expect.any(AbortSignal));

    const invalid = renderHook(() => useProduct(Number.NaN), { wrapper: queryWrapper(createTestQueryClient()) });
    expect(invalid.result.current.error).toBe(true);
    expect(invalid.result.current.loading).toBe(false);
    expect(getProduct).toHaveBeenCalledTimes(1);
  });

  it("refetches on mount for edit forms even when the cached detail is fresh", async () => {
    const client = createTestQueryClient();
    vi.mocked(getProduct).mockResolvedValueOnce(ok(makeProduct(7, { name: "Old" })));
    const first = renderHook(() => useProduct(7), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(first.result.current.product?.name).toBe("Old"));
    first.unmount();

    let resolveFresh: (value: ReturnType<typeof ok>) => void = () => {};
    vi.mocked(getProduct).mockImplementationOnce(() => new Promise((resolve) => { resolveFresh = resolve as typeof resolveFresh; }));
    const edit = renderHook(() => useProduct(7, { freshForEdit: true }), { wrapper: queryWrapper(client) });
    expect(edit.result.current.loading).toBe(true);

    resolveFresh(ok(makeProduct(7, { name: "New" })));
    await waitFor(() => expect(edit.result.current.loading).toBe(false));
    expect(edit.result.current.product?.name).toBe("New");
  });
});
