import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import { productKeys } from "../api/queryKeys";
import { useProducts } from "../hooks/useProducts";
import { createTestQueryClient, makeList, makeProduct, makeQuery } from "../test/testUtils";
import { AuthProvider, useAuth } from "./AuthContext";

// Real AuthProvider, real Axios interceptors; only the network adapter is faked.
type Handler = (config: InternalAxiosRequestConfig, callNumber: number) => { status: number; data?: unknown };
let calls: string[];
let handlers: Record<string, Handler>;
const originalAdapter = api.defaults.adapter;

const adapter: AxiosAdapter = async (config) => {
  const key = `${config.method?.toUpperCase()} ${config.url}`;
  calls.push(key);
  const { status, data } = handlers[key](config, calls.filter((call) => call === key).length);
  const response = { data, status, statusText: "", headers: {}, config };
  if (status >= 400) throw new AxiosError("failed", AxiosError.ERR_BAD_REQUEST, config, null, response);
  return response;
};

const ME = "GET /api/v1/auth/me";
const LIST = "GET /api/v1/products";
const REFRESH = "POST /api/v1/auth/refresh";
const admin = { id: 1, email: "admin@example.com", role: "ADMIN", is_active: true, created_at: "2026-01-01T00:00:00Z" };
const query = makeQuery();

function Probe() {
  const { user } = useAuth();
  const { data, retry } = useProducts(query);
  return (
    <>
      <p data-testid="user">{user?.email ?? "anonymous"}</p>
      <p data-testid="products">{data?.items.map((item) => item.name).join(",") ?? "none"}</p>
      <button onClick={retry}>reload</button>
    </>
  );
}

function setup() {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  calls = [];
  handlers = { [ME]: () => ({ status: 200, data: admin }) };
  api.defaults.adapter = adapter;
});
afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe("session expiry (refresh rejected)", () => {
  it("clears the user and the whole cache, and does not loop on the refetches that follow", async () => {
    handlers[LIST] = (_config, n) => (n === 1 ? { status: 200, data: makeList([makeProduct(1, { name: "private" })]) } : { status: 401 });
    handlers[REFRESH] = () => ({ status: 401 });
    const client = setup();
    await screen.findByText("private");
    const hidden = productKeys.detail(99);
    client.setQueryData(hidden, makeProduct(99, { name: "secret" }));
    const resetQueries = vi.spyOn(client, "resetQueries");

    await userEvent.click(screen.getByText("reload"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anonymous"));
    expect(screen.queryByText("private")).not.toBeInTheDocument();
    expect(client.getQueryData(hidden)).toBeUndefined();
    expect(resetQueries).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((call) => call === REFRESH).length).toBeLessThanOrEqual(2);
  });

  it("a rejected refresh with 403 also ends the session", async () => {
    handlers[LIST] = (_config, n) => (n === 1 ? { status: 200, data: makeList([makeProduct(1)]) } : { status: 401 });
    handlers[REFRESH] = () => ({ status: 403 });
    setup();
    await waitFor(() => expect(screen.getByTestId("products")).toHaveTextContent("Product 1"));

    await userEvent.click(screen.getByText("reload"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anonymous"));
  });

  it("a temporary refresh failure (503) keeps the user signed in and the cache intact", async () => {
    handlers[LIST] = (_config, n) => (n === 1 ? { status: 200, data: makeList([makeProduct(1, { name: "kept" })]) } : { status: 401 });
    handlers[REFRESH] = () => ({ status: 503 });
    const client = setup();
    await screen.findByText("kept");
    const resetQueries = vi.spyOn(client, "resetQueries");

    await userEvent.click(screen.getByText("reload"));
    await waitFor(() => expect(calls).toContain(REFRESH));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByTestId("user")).toHaveTextContent("admin@example.com");
    expect(resetQueries).not.toHaveBeenCalled();
  });
});
