import { hashKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { categoryKeys, productKeys } from "./queryKeys";
import { makeQuery } from "../test/testUtils";
import type { ProductCursorFilters } from "../types/catalog";

describe("productKeys", () => {
  it("separates every filter, sort and page into its own cache entry", () => {
    const base = makeQuery();
    const variants = [
      makeQuery({ page: 2 }),
      makeQuery({ page_size: 20 }),
      makeQuery({ search: "phone" }),
      makeQuery({ category_id: 3 }),
      makeQuery({ min_price: "10" }),
      makeQuery({ max_price: "99" }),
      makeQuery({ sort_by: "price" }),
      makeQuery({ order: "asc" }),
    ];
    const hashes = new Set([base, ...variants].map((query) => hashKey(productKeys.list(query))));
    expect(hashes.size).toBe(variants.length + 1);
  });

  it("produces the same key regardless of property order or undefined fields", () => {
    const a = makeQuery({ search: "x", category_id: 2 });
    const b = { order: "desc", sort_by: "created_at", category_id: 2, search: "x", page_size: 10, page: 1, min_price: undefined } as const;
    expect(hashKey(productKeys.list(a))).toBe(hashKey(productKeys.list(b)));
  });

  it("ignores properties that do not affect the response", () => {
    const withExtra = { ...makeQuery(), cursorForDebug: "abc" };
    expect(hashKey(productKeys.list(withExtra))).toBe(hashKey(productKeys.list(makeQuery())));
  });

  it("nests lists and details under the same root, and keeps them apart", () => {
    expect(productKeys.list(makeQuery()).slice(0, 2)).toEqual(productKeys.lists());
    expect(productKeys.detail(1).slice(0, 2)).toEqual(productKeys.details());
    expect(hashKey(productKeys.detail(1))).not.toBe(hashKey(productKeys.detail(2)));
    expect(productKeys.lists()[0]).toBe(productKeys.all[0]);
  });

  it("keeps category keys outside the product tree", () => {
    expect(categoryKeys.lists()[0]).toBe("categories");
    expect(categoryKeys.all[0]).not.toBe(productKeys.all[0]);
  });
});

describe("productKeys.cursorList", () => {
  const base: ProductCursorFilters = { limit: 8 };

  it("separates every cursor filter into its own entry and ignores the cursor itself", () => {
    const variants: ProductCursorFilters[] = [
      { limit: 16 },
      { limit: 8, search: "phone" },
      { limit: 8, category_id: 3 },
      { limit: 8, min_price: "10" },
      { limit: 8, max_price: "99" },
    ];
    const hashes = new Set([base, ...variants].map((filters) => hashKey(productKeys.cursorList(filters))));
    expect(hashes.size).toBe(variants.length + 1);
    const withCursor = { ...base, cursor: "abc" } as ProductCursorFilters;
    expect(hashKey(productKeys.cursorList(withCursor))).toBe(hashKey(productKeys.cursorList(base)));
  });

  it("lives under lists() so list invalidation reaches it, but never collides with an offset list", () => {
    expect(productKeys.cursorList(base).slice(0, 2)).toEqual(productKeys.lists());
    expect(hashKey(productKeys.cursorList(base))).not.toBe(hashKey(productKeys.list(makeQuery())));
  });
});
