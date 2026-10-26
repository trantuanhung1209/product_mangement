import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCategory, deleteCategory, updateCategory } from "../api/categories";
import { categoryKeys, productKeys } from "../api/queryKeys";
import { createTestQueryClient, makeCategory, makeList, makeProduct, makeQuery, ok, queryWrapper } from "../test/testUtils";
import { useDeleteCategory, useSaveCategory } from "./useCategoryMutations";

vi.mock("../api/categories");

const payload = { name: "Tablets", description: null };

function seededClient() {
  const client = createTestQueryClient();
  client.setQueryData(categoryKeys.lists(), [makeCategory(1)]);
  client.setQueryData(productKeys.list(makeQuery()), makeList([makeProduct(1)]));
  return client;
}

beforeEach(() => vi.resetAllMocks());

describe("category mutations", () => {
  it.each([
    ["create", undefined, () => vi.mocked(createCategory).mockResolvedValue(ok(makeCategory(2)))],
    ["update", 1, () => vi.mocked(updateCategory).mockResolvedValue(ok(makeCategory(1, "Renamed")))],
  ])("%s invalidates only the categories cache", async (_name, id, arrange) => {
    arrange();
    const client = seededClient();
    const { result } = renderHook(() => useSaveCategory(id), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync(payload);

    expect(client.getQueryState(categoryKeys.lists())?.isInvalidated).toBe(true);
    expect(client.getQueryState(productKeys.list(makeQuery()))?.isInvalidated).toBe(false);
  });

  it("delete invalidates categories; a failed delete (e.g. 409 in use) invalidates nothing", async () => {
    const client = seededClient();
    const { result } = renderHook(() => useDeleteCategory(), { wrapper: queryWrapper(client) });

    vi.mocked(deleteCategory).mockRejectedValueOnce(new Error("409"));
    await expect(result.current.mutateAsync(1)).rejects.toThrow("409");
    expect(client.getQueryState(categoryKeys.lists())?.isInvalidated).toBe(false);
    expect(deleteCategory).toHaveBeenCalledTimes(1);

    vi.mocked(deleteCategory).mockResolvedValueOnce(ok(undefined));
    await result.current.mutateAsync(1);
    expect(client.getQueryState(categoryKeys.lists())?.isInvalidated).toBe(true);
  });
});
