import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../api/auth";
import * as cartApi from "../../api/cart";
import { AuthProvider } from "../../auth/AuthContext";
import { CartProvider } from "../../cart/CartContext";
import { createTestQueryClient, ok } from "../../test/testUtils";
import { ToastProvider } from "../feedback/Toast";
import { StorefrontShell } from "./StorefrontShell";

vi.mock("../../api/auth");
vi.mock("../../api/cart");

function renderShell() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>
              <StorefrontShell>
                <Link to="/elsewhere">go elsewhere</Link>
                <button>page content</button>
              </StorefrontShell>
            </ToastProvider>
          </CartProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const menu = () => screen.getByText("Tài khoản").closest("details") as HTMLDetailsElement;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.getCurrentUser).mockResolvedValue(
    ok({ id: 1, email: "me@example.com", role: "USER" as const, is_active: true, created_at: "2026-01-01T00:00:00Z" }),
  );
  vi.mocked(cartApi.getCart).mockResolvedValue(ok({ items: [], total_quantity: 0, subtotal: "0" }));
});

describe("account menu", () => {
  async function open() {
    await screen.findByText("Tài khoản");
    await userEvent.click(screen.getByText("Tài khoản"));
    expect(menu().open).toBe(true);
  }

  it("closes when the user clicks elsewhere", async () => {
    renderShell();
    await open();
    await userEvent.click(screen.getByText("page content"));
    expect(menu().open).toBe(false);
  });

  it("stays open when the click is inside the menu", async () => {
    renderShell();
    await open();
    await userEvent.click(screen.getByText("me@example.com"));
    expect(menu().open).toBe(true);
  });

  it("closes on Escape and returns focus to the menu button", async () => {
    renderShell();
    await open();
    await userEvent.keyboard("{Escape}");
    expect(menu().open).toBe(false);
    expect(screen.getByText("Tài khoản").closest("summary")).toHaveFocus();
  });

  it("closes after the user picks a destination", async () => {
    renderShell();
    await open();
    await userEvent.click(screen.getByRole("link", { name: "Quản lý phiên đăng nhập" }));
    await waitFor(() => expect(menu().open).toBe(false));
  });
});
