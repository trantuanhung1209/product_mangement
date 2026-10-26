import { renderHook, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useCategories } from "../hooks/useCategories";
import { useProducts } from "../hooks/useProducts";
import { createTestQueryClient, makeCategory, makeList, makeProduct, makeQuery, queryWrapper } from "../test/testUtils";
import { api } from "./client";

// Real Axios client and interceptors; only the network adapter is replaced.
type Handler = (config: InternalAxiosRequestConfig, callNumber: number) => { status: number; data?: unknown };
let calls: string[];
let handlers: Record<string, Handler>;
const originalAdapter = api.defaults.adapter;

const adapter: AxiosAdapter = async (config) => {
  const key = `${config.method?.toUpperCase()} ${config.url}`;
  calls.push(key);
  const callNumber = calls.filter((call) => call === key).length;
  const { status, data } = handlers[key](config, callNumber);
  const response = { data, status, statusText: "", headers: {}, config };
  if (status >= 400) throw new AxiosError("failed", AxiosError.ERR_BAD_REQUEST, config, null, response);
  return response;
};

beforeEach(() => {
  calls = [];
  handlers = {};
  api.defaults.adapter = adapter;
});
afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

const LIST = "GET /api/v1/products";
const REFRESH = "POST /api/v1/auth/refresh";

describe("TanStack Query with the existing refresh interceptor", () => {
  it("a 401 triggers one refresh, the interceptor replays the request, and the query succeeds without a query-level retry", async () => {
    const list = makeList([makeProduct(1)]);
    handlers[LIST] = (_config, n) => (n === 1 ? { status: 401 } : { status: 200, data: list });
    handlers[REFRESH] = () => ({ status: 200 });
    const { result } = renderHook(() => useProducts(makeQuery()), { wrapper: queryWrapper(createTestQueryClient()) });

    await waitFor(() => expect(result.current.data).toEqual(list));
    expect(calls).toEqual([LIST, REFRESH, LIST]);
  });

  it("concurrent queries that hit 401 share a single refresh request", async () => {
    handlers[LIST] = (_config, n) => (n === 1 ? { status: 401 } : { status: 200, data: makeList([]) });
    handlers["GET /api/v1/categories"] = (_config, n) => (n === 1 ? { status: 401 } : { status: 200, data: [makeCategory(1)] });
    handlers[REFRESH] = () => ({ status: 200 });
    const wrapper = queryWrapper(createTestQueryClient());
    const products = renderHook(() => useProducts(makeQuery()), { wrapper });
    const categories = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(products.result.current.data).toBeDefined());
    await waitFor(() => expect(categories.result.current.categories).toHaveLength(1));
    expect(calls.filter((call) => call === REFRESH)).toHaveLength(1);
  });

  it("when refresh fails the query ends in an error state and is not retried against the API", async () => {
    handlers[LIST] = () => ({ status: 401 });
    handlers[REFRESH] = () => ({ status: 401 });
    const { result } = renderHook(() => useProducts(makeQuery()), { wrapper: queryWrapper(createTestQueryClient()) });

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(calls).toEqual([LIST, REFRESH]);
  });
});
