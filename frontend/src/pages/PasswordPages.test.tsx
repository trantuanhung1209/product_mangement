import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import { AuthProvider } from "../auth/AuthContext";
import { createTestQueryClient, ok } from "../test/testUtils";
import type { AuthUser } from "../types/catalog";
import { ChangePasswordPage } from "./ChangePasswordPage";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { LoginPage } from "./LoginPage";

vi.mock("../api/auth");

const me: AuthUser = { id: 3, email: "me@example.com", role: "USER", is_active: true, created_at: "2026-01-01T00:00:00Z" };
const OLD = "Old!Passw0rd-1";
const NEW = "N3w!Passw0rd-ok";
const accepted = (expires = 300, resend = 60) => ok({ message: "ok", expires_in_seconds: expires, resend_in_seconds: resend });
const failure = (status: number, data: unknown = {}, headers: Record<string, string> = {}) =>
  new AxiosError("failed", "ERR_BAD_REQUEST", undefined, undefined, { status, data, headers } as unknown as AxiosResponse);

function renderAt(path: string, client: QueryClient = createTestQueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/account/password" element={<ChangePasswordPage />} />
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

async function advance(seconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(seconds * 1000); });
}

describe("password pages", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(failure(401));
    vi.mocked(authApi.forgotPassword).mockResolvedValue(accepted());
    vi.mocked(authApi.resetPassword).mockResolvedValue(ok(undefined));
    vi.mocked(authApi.changePassword).mockResolvedValue(ok(undefined));
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  describe("forgot password", () => {
    async function toResetStep(user: ReturnType<typeof renderAt>) {
      await user.type(screen.getByLabelText("Email"), "me@example.com");
      await user.click(screen.getByRole("button", { name: /Gửi mã xác minh/ }));
      await screen.findByText("Nhập mã và mật khẩu mới");
    }

    it("sends the email, then resets with the code and lands on /login with a notice", async () => {
      const user = renderAt("/forgot-password");
      await toResetStep(user);
      expect(authApi.forgotPassword).toHaveBeenCalledWith("me@example.com");

      await user.type(screen.getByLabelText("Mã xác minh"), "123456");
      await user.type(screen.getByLabelText("Mật khẩu mới"), NEW);
      await user.type(screen.getByLabelText("Xác nhận mật khẩu mới"), NEW);
      await user.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" }));

      expect(authApi.resetPassword).toHaveBeenCalledWith("me@example.com", "123456", NEW);
      expect(await screen.findByText("Chào mừng trở lại")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Đã đặt lại mật khẩu");
    });

    it("validates the new password and the confirmation before calling the server", async () => {
      const user = renderAt("/forgot-password");
      await toResetStep(user);
      await user.type(screen.getByLabelText("Mã xác minh"), "123456");
      await user.type(screen.getByLabelText("Mật khẩu mới"), "lowercase1!");
      await user.type(screen.getByLabelText("Xác nhận mật khẩu mới"), "different");
      await user.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" }));
      expect(screen.getByLabelText("Mật khẩu mới")).toHaveAccessibleDescription(/chữ hoa/);
      expect(screen.getByLabelText("Xác nhận mật khẩu mới")).toHaveAccessibleDescription("Mật khẩu xác nhận không khớp.");
      expect(authApi.resetPassword).not.toHaveBeenCalled();
    });

    it("keeps resend disabled for 60 seconds and counts the code lifetime down", async () => {
      const user = renderAt("/forgot-password");
      await toResetStep(user);
      expect(screen.getByRole("timer")).toHaveTextContent("5:00");
      expect(screen.getByRole("button", { name: "Gửi lại mã (60s)" })).toBeDisabled();
      await advance(59);
      expect(screen.getByRole("button", { name: /Gửi lại mã/ })).toBeDisabled();
      await advance(1);
      expect(screen.getByRole("button", { name: "Gửi lại mã" })).toBeEnabled();
    });

    it("blocks the reset once the code has expired", async () => {
      const user = renderAt("/forgot-password");
      await toResetStep(user);
      await user.type(screen.getByLabelText("Mã xác minh"), "123456");
      await advance(301);
      expect(screen.getByRole("timer")).toHaveTextContent("Mã đã hết hạn");
      expect(screen.getByRole("button", { name: "Đặt lại mật khẩu" })).toBeDisabled();
    });

    it("shows the server's message for a wrong code and stays on the page", async () => {
      vi.mocked(authApi.resetPassword).mockRejectedValue(failure(400, { detail: "Mã OTP không đúng hoặc đã hết hạn." }));
      const user = renderAt("/forgot-password");
      await toResetStep(user);
      await user.type(screen.getByLabelText("Mã xác minh"), "000000");
      await user.type(screen.getByLabelText("Mật khẩu mới"), NEW);
      await user.type(screen.getByLabelText("Xác nhận mật khẩu mới"), NEW);
      await user.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Mã OTP không đúng hoặc đã hết hạn.");
      expect(screen.queryByText("Chào mừng trở lại")).not.toBeInTheDocument();
    });

    it("shows the wait time on 429", async () => {
      vi.mocked(authApi.forgotPassword).mockRejectedValue(failure(429, { detail: "x" }, { "retry-after": "37" }));
      const user = renderAt("/forgot-password");
      await user.type(screen.getByLabelText("Email"), "me@example.com");
      await user.click(screen.getByRole("button", { name: /Gửi mã xác minh/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent("đợi 37 giây");
    });

    it("toggles password visibility on the new password", async () => {
      const user = renderAt("/forgot-password");
      await toResetStep(user);
      await user.click(screen.getByRole("button", { name: "Hiện mật khẩu mới" }));
      expect(screen.getByLabelText("Mật khẩu mới")).toHaveAttribute("type", "text");
    });

    it("is reachable from the login page", async () => {
      const user = renderAt("/login");
      await user.click(screen.getByRole("link", { name: "Quên mật khẩu?" }));
      expect(await screen.findByText("Đặt lại mật khẩu", { selector: "h2" })).toBeInTheDocument();
    });
  });

  describe("change password", () => {
    beforeEach(() => { vi.mocked(authApi.getCurrentUser).mockResolvedValue(ok(me)); });

    async function fill(user: ReturnType<typeof renderAt>, current = OLD, next = NEW, confirmation = next) {
      await user.type(await screen.findByLabelText("Mật khẩu hiện tại"), current);
      await user.type(screen.getByLabelText("Mật khẩu mới"), next);
      await user.type(screen.getByLabelText("Xác nhận mật khẩu mới"), confirmation);
    }

    it("signs the user out, clears the cache and goes to /login", async () => {
      const client = createTestQueryClient();
      const user = renderAt("/account/password", client);
      await fill(user);
      client.setQueryData(["private", "orders"], { secret: true });
      await user.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));

      expect(authApi.changePassword).toHaveBeenCalledWith(OLD, NEW);
      expect(await screen.findByText("Chào mừng trở lại")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Đã đổi mật khẩu. Vui lòng đăng nhập lại.");
      await waitFor(() => expect(client.getQueryData(["private", "orders"])).toBeUndefined());
      expect(authApi.logout).not.toHaveBeenCalled(); // the server already ended the session
    });

    it("refuses a new password equal to the current one without calling the server", async () => {
      const user = renderAt("/account/password");
      await fill(user, OLD, OLD);
      await user.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
      expect(screen.getByLabelText("Mật khẩu mới")).toHaveAccessibleDescription(/Mật khẩu mới phải khác mật khẩu hiện tại\./);
      expect(authApi.changePassword).not.toHaveBeenCalled();
    });

    it("applies the same rules as the backend to the new password", async () => {
      const user = renderAt("/account/password");
      await fill(user, OLD, "NoSpecial123");
      await user.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
      expect(screen.getByLabelText("Mật khẩu mới")).toHaveAccessibleDescription(/ký tự đặc biệt/);
      expect(authApi.changePassword).not.toHaveBeenCalled();
    });

    it("stays signed in and shows the server message when the current password is wrong", async () => {
      vi.mocked(authApi.changePassword).mockRejectedValue(failure(400, { detail: "Mật khẩu hiện tại không đúng." }));
      const user = renderAt("/account/password");
      await fill(user);
      await user.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Mật khẩu hiện tại không đúng.");
      expect(screen.queryByText("Chào mừng trở lại")).not.toBeInTheDocument();
    });

    it("toggles the visibility of each field", async () => {
      const user = renderAt("/account/password");
      await screen.findByLabelText("Mật khẩu hiện tại");
      await user.click(screen.getByRole("button", { name: "Hiện mật khẩu hiện tại" }));
      expect(screen.getByLabelText("Mật khẩu hiện tại")).toHaveAttribute("type", "text");
      expect(screen.getByLabelText("Mật khẩu mới")).toHaveAttribute("type", "password");
    });
  });
});
