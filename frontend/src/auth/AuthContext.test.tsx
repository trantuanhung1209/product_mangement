import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import { getProducts } from "../api/products";
import { productKeys } from "../api/queryKeys";
import { useProducts } from "../hooks/useProducts";
import { createTestQueryClient, makeList, makeProduct, makeQuery, ok } from "../test/testUtils";
import type { AuthUser } from "../types/catalog";
import { AuthProvider, useAuth } from "./AuthContext";

vi.mock("../api/auth");
vi.mock("../api/products");

const user = (id: number, role: AuthUser["role"] = "ADMIN"): AuthUser => ({
  id,
  email: `user${id}@example.com`,
  role,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
});

const query = makeQuery();

function Probe() {
  const { user: current, login, logout } = useAuth();
  const { data } = useProducts(query);
  return (
    <>
      <p data-testid="user">{current?.email ?? "anonymous"}</p>
      <p data-testid="products">{data?.items.map((item) => item.name).join(",") ?? "none"}</p>
      <button onClick={() => void login("b@example.com", "pw")}>login</button>
      <button onClick={() => logout().catch(() => undefined)}>logout</button>
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
  vi.resetAllMocks();
  vi.mocked(authApi.getCurrentUser).mockResolvedValue(ok(user(1)));
});

describe("AuthProvider and the query cache", () => {
  it("logout drops cached data and refetches active queries instead of keeping the old user's data", async () => {
    vi.mocked(getProducts)
      .mockResolvedValueOnce(ok(makeList([makeProduct(1, { name: "private-for-user-1" })])))
      .mockResolvedValueOnce(ok(makeList([makeProduct(2, { name: "after-logout" })])));
    vi.mocked(authApi.logout).mockResolvedValue(ok(undefined));
    const client = setup();
    await screen.findByText("private-for-user-1");

    await userEvent.click(screen.getByText("logout"));

    await screen.findByText("after-logout");
    expect(screen.getByTestId("user")).toHaveTextContent("anonymous");
    expect(screen.queryByText("private-for-user-1")).not.toBeInTheDocument();
    expect(client.getQueryData(productKeys.list(query))).toMatchObject({ items: [{ name: "after-logout" }] });
  });

  it("logout clears cached queries nobody is currently displaying", async () => {
    vi.mocked(getProducts).mockResolvedValue(ok(makeList([])));
    vi.mocked(authApi.logout).mockResolvedValue(ok(undefined));
    const client = setup();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("user1@example.com"));
    const hidden = productKeys.detail(99);
    client.setQueryData(hidden, makeProduct(99, { name: "secret" }));

    await userEvent.click(screen.getByText("logout"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anonymous"));
    expect(client.getQueryData(hidden)).toBeUndefined();
  });

  it("switching accounts refetches with the new identity and never shows the previous account's data", async () => {
    vi.mocked(getProducts)
      .mockResolvedValueOnce(ok(makeList([makeProduct(1, { name: "account-a-data" })])))
      .mockResolvedValueOnce(ok(makeList([makeProduct(2, { name: "account-b-data" })])));
    vi.mocked(authApi.login).mockResolvedValue(ok(user(2, "USER")));
    setup();
    await screen.findByText("account-a-data");

    await userEvent.click(screen.getByText("login"));

    await screen.findByText("account-b-data");
    expect(screen.getByTestId("user")).toHaveTextContent("user2@example.com");
    expect(screen.queryByText("account-a-data")).not.toBeInTheDocument();
  });

  it("keeps the cache when logout fails (user is still signed in)", async () => {
    vi.mocked(getProducts).mockResolvedValue(ok(makeList([makeProduct(1, { name: "still-here" })])));
    vi.mocked(authApi.logout).mockRejectedValue(new Error("network"));
    const client = setup();
    await screen.findByText("still-here");

    await userEvent.click(screen.getByText("logout"));

    expect(screen.getByTestId("user")).toHaveTextContent("user1@example.com");
    expect(client.getQueryData(productKeys.list(query))).toBeDefined();
  });
});
