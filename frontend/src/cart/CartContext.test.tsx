import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import * as cartApi from "../api/cart";
import { cartKeys } from "../api/queryKeys";
import { AuthProvider, useAuth } from "../auth/AuthContext";
import { createTestQueryClient, ok } from "../test/testUtils";
import type { AuthUser, Cart } from "../types/catalog";
import { CartProvider, useCart } from "./CartContext";

vi.mock("../api/auth");
vi.mock("../api/cart");

const user = (id: number): AuthUser => ({ id, email: `user${id}@example.com`, role: "USER", is_active: true, created_at: "2026-01-01T00:00:00Z" });
const cartOf = (quantity: number): Cart => ({
  items: quantity ? [{ product_id: 1, name: "Item", image_url: null, unit_price: "10", quantity, line_total: "10", available_stock: 9, is_available: true }] : [],
  total_quantity: quantity,
  subtotal: String(quantity * 10),
});
const httpError = (status: number) => new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, { status } as AxiosResponse);

function Probe() {
  const { cart, loading, error, addItem, updateItem, removeItem, clear, refresh } = useCart();
  const { login, logout } = useAuth();
  const swallow = (promise: Promise<unknown>) => void promise.catch(() => undefined);
  return (
    <>
      <p data-testid="qty">{cart.total_quantity}</p>
      <p data-testid="loading">{String(loading)}</p>
      <p data-testid="error">{error ?? "none"}</p>
      <button onClick={() => swallow(addItem(1, 1))}>add</button>
      <button onClick={() => swallow(updateItem(1, 3))}>update</button>
      <button onClick={() => swallow(removeItem(1))}>remove</button>
      <button onClick={() => swallow(clear())}>clear</button>
      <button onClick={() => swallow(refresh())}>refresh</button>
      <button onClick={() => void login("b@example.com", "pw")}>login</button>
      <button onClick={() => void logout()}>logout</button>
    </>
  );
}

function setup(currentUser: AuthUser | null = user(1)) {
  if (currentUser) vi.mocked(authApi.getCurrentUser).mockResolvedValue(ok(currentUser));
  else vi.mocked(authApi.getCurrentUser).mockRejectedValue(httpError(401));
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <CartProvider>
          <Probe />
        </CartProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => vi.resetAllMocks());

describe("CartProvider on TanStack Query", () => {
  it("does not request the cart for an anonymous visitor", async () => {
    setup(null);
    await waitFor(() => expect(authApi.getCurrentUser).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cartApi.getCart).not.toHaveBeenCalled();
    expect(screen.getByTestId("qty")).toHaveTextContent("0");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  it("loads the signed-in user's cart under a per-user key", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(ok(cartOf(2)));
    const client = setup();
    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("2"));
    expect(client.getQueryData(cartKeys.user(1))).toEqual(cartOf(2));
    expect(cartApi.getCart).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it.each([
    ["add", () => vi.mocked(cartApi.addCartItem).mockResolvedValue(ok(cartOf(1))), () => expect(cartApi.addCartItem).toHaveBeenCalledWith(1, 1)],
    ["update", () => vi.mocked(cartApi.updateCartItem).mockResolvedValue(ok(cartOf(3))), () => expect(cartApi.updateCartItem).toHaveBeenCalledWith(1, 3)],
    ["remove", () => vi.mocked(cartApi.removeCartItem).mockResolvedValue(ok(undefined)), () => expect(cartApi.removeCartItem).toHaveBeenCalledWith(1)],
    ["clear", () => vi.mocked(cartApi.clearCart).mockResolvedValue(ok(undefined)), () => expect(cartApi.clearCart).toHaveBeenCalledTimes(1)],
  ])("%s calls the API once and then refetches the cart", async (button, arrange, assertCall) => {
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(ok(cartOf(0))).mockResolvedValue(ok(cartOf(5)));
    arrange();
    setup();
    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByText(button));

    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("5"));
    assertCall();
    expect(cartApi.getCart).toHaveBeenCalledTimes(2);
  });

  it("maps a 409 to the stock message, rejects with it, and still refetches the cart", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(ok(cartOf(1)));
    vi.mocked(cartApi.addCartItem).mockRejectedValue(httpError(409));
    setup();
    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("1"));

    await userEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("vượt quá tồn kho"));
    expect(cartApi.addCartItem).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledTimes(2));
  });

  it("exposes a load error and recovers through refresh()", async () => {
    vi.mocked(cartApi.getCart).mockRejectedValueOnce(httpError(404)).mockResolvedValue(ok(cartOf(4)));
    setup();
    await waitFor(() => expect(screen.getByTestId("error")).not.toHaveTextContent("none"));

    await userEvent.click(screen.getByText("refresh"));

    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("4"));
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("logout removes the cart from the cache and shows an empty cart", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValue(ok(cartOf(2)));
    vi.mocked(authApi.logout).mockResolvedValue(ok(undefined));
    const client = setup();
    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("2"));

    await userEvent.click(screen.getByText("logout"));

    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("0"));
    expect(client.getQueryData(cartKeys.user(1))).toBeUndefined();
    expect(cartApi.getCart).toHaveBeenCalledTimes(1);
  });

  it("switching accounts shows the new account's cart and never the previous one", async () => {
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(ok(cartOf(2))).mockResolvedValue(ok(cartOf(7)));
    vi.mocked(authApi.login).mockResolvedValue(ok(user(2)));
    const client = setup();
    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("2"));

    await userEvent.click(screen.getByText("login"));

    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("7"));
    expect(client.getQueryData(cartKeys.user(1))).toBeUndefined();
    expect(client.getQueryData(cartKeys.user(2))).toEqual(cartOf(7));
  });
});
