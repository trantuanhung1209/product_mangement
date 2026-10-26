import { renderHook, waitFor, act } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getProductsCursor } from "../api/products";
import { productKeys } from "../api/queryKeys";
import { createTestQueryClient, makeProduct, ok, queryWrapper } from "../test/testUtils";
import type { ProductCursorResponse } from "../types/catalog";
import { useProductsCursor } from "./useProductsCursor";

vi.mock("../api/products");

const page = (ids: number[], next: string | null): ProductCursorResponse => ({
  items: ids.map((id) => makeProduct(id)),
  next_cursor: next,
  has_more: next !== null,
});
const serverError = () => new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, { status: 500 } as AxiosResponse);
const filters = { limit: 2 };

beforeEach(() => vi.resetAllMocks());

describe("useProductsCursor", () => {
  it("loads the first page without a cursor, then passes next_cursor to load more and appends", async () => {
    vi.mocked(getProductsCursor)
      .mockResolvedValueOnce(ok(page([3, 2], "c1")))
      .mockResolvedValueOnce(ok(page([1], null)));
    const { result } = renderHook(() => useProductsCursor(filters), { wrapper: queryWrapper(createTestQueryClient()) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([3, 2]));
    expect(getProductsCursor).toHaveBeenLastCalledWith({ limit: 2, cursor: undefined }, expect.any(AbortSignal));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([3, 2, 1]));
    expect(getProductsCursor).toHaveBeenLastCalledWith({ limit: 2, cursor: "c1" }, expect.any(AbortSignal));
    expect(result.current.hasMore).toBe(false);
    expect(getProductsCursor).toHaveBeenCalledTimes(2);
  });

  it("restarts from the first page, with no stale items, when a filter changes", async () => {
    vi.mocked(getProductsCursor).mockImplementation(async (params) =>
      ok(params.category_id === 9 ? page([50], null) : page([3, 2], "c1")),
    );
    const { result, rerender } = renderHook(({ current }) => useProductsCursor(current), {
      initialProps: { current: filters as { limit: number; category_id?: number } },
      wrapper: queryWrapper(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    rerender({ current: { limit: 2, category_id: 9 } });
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([50]));
    expect(getProductsCursor).toHaveBeenLastCalledWith({ limit: 2, category_id: 9, cursor: undefined }, expect.any(AbortSignal));
  });

  it("does nothing while disabled", () => {
    renderHook(() => useProductsCursor(filters, { enabled: false }), { wrapper: queryWrapper(createTestQueryClient()) });
    expect(getProductsCursor).not.toHaveBeenCalled();
  });

  it("a failed first page is an error that retry() recovers from", async () => {
    vi.mocked(getProductsCursor).mockRejectedValueOnce(new AxiosError("bad", "ERR_BAD_REQUEST", undefined, undefined, { status: 400 } as AxiosResponse));
    vi.mocked(getProductsCursor).mockResolvedValueOnce(ok(page([1], null)));
    const { result } = renderHook(() => useProductsCursor(filters), { wrapper: queryWrapper(createTestQueryClient()) });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.loadMoreError).toBe(false);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.error).toBe(false);
  });

  it("a failed load-more keeps the loaded items, flags loadMoreError, and retries the same cursor", async () => {
    vi.mocked(getProductsCursor)
      .mockResolvedValueOnce(ok(page([3, 2], "c1")))
      .mockRejectedValueOnce(new AxiosError("bad", "ERR_BAD_REQUEST", undefined, undefined, { status: 400 } as AxiosResponse))
      .mockResolvedValueOnce(ok(page([1], null)));
    const { result } = renderHook(() => useProductsCursor(filters), { wrapper: queryWrapper(createTestQueryClient()) });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadMoreError).toBe(true));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.error).toBe(false);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(getProductsCursor).toHaveBeenLastCalledWith({ limit: 2, cursor: "c1" }, expect.any(AbortSignal));
    expect(result.current.loadMoreError).toBe(false);
  });

  it("invalidating product lists refetches every loaded page with the cursor each page was fetched with", async () => {
    const client = createTestQueryClient();
    vi.mocked(getProductsCursor)
      .mockResolvedValueOnce(ok(page([3, 2], "c1")))
      .mockResolvedValueOnce(ok(page([1], null)))
      .mockResolvedValueOnce(ok(page([3, 2], "c1")))
      .mockResolvedValueOnce(ok(page([1], null)));
    const { result } = renderHook(() => useProductsCursor(filters), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    await act(() => client.invalidateQueries({ queryKey: productKeys.lists() }));

    const cursors = vi.mocked(getProductsCursor).mock.calls.map(([params]) => params.cursor);
    expect(cursors).toEqual([undefined, "c1", undefined, "c1"]);
    expect(result.current.items).toHaveLength(3);
  });

  it("does not retry client errors but retries transient server errors a bounded number of times", async () => {
    vi.mocked(getProductsCursor).mockRejectedValue(serverError());
    const { result } = renderHook(() => useProductsCursor(filters), { wrapper: queryWrapper(createTestQueryClient()) });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(getProductsCursor).toHaveBeenCalledTimes(3);
  });
});
