import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import { AuthProvider } from "../auth/AuthContext";
import { createTestQueryClient, ok } from "../test/testUtils";
import type { AuthUser } from "../types/catalog";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";

vi.mock("../api/auth");

const created: AuthUser = { id: 7, email: "new@example.com", role: "USER", is_active: true, created_at: "2026-01-01T00:00:00Z" };
const PASSWORD = "Str0ng!Passw0rd";
const accepted = (expires = 300, resend = 60) => ok({ message: "ok", expires_in_seconds: expires, resend_in_seconds: resend });
const failure = (status: number, data: unknown = {}, headers: Record<string, string> = {}) =>
  new AxiosError("failed", "ERR_BAD_REQUEST", undefined, undefined, { status, data, headers } as unknown as AxiosResponse);

function renderPage(path = "/register") {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/shop" element={<p>Trang cửa hàng</p>} />
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

async function fillDetails(user: ReturnType<typeof userEvent.setup>, overrides: { password?: string; confirmation?: string } = {}) {
  await user.type(screen.getByLabelText("Email"), "new@example.com");
  await user.type(screen.getByLabelText("Mật khẩu"), overrides.password ?? PASSWORD);
  await user.type(screen.getByLabelText("Xác nhận mật khẩu"), overrides.confirmation ?? overrides.password ?? PASSWORD);
}

async function goToOtpStep(user: ReturnType<typeof userEvent.setup>) {
  await fillDetails(user);
  await user.click(screen.getByRole("button", { name: /Gửi mã xác minh/ }));
  await screen.findByText("Nhập mã xác minh");
}

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(failure(401));
    vi.mocked(authApi.requestRegistrationOtp).mockResolvedValue(accepted());
    vi.mocked(authApi.resendRegistrationOtp).mockResolvedValue(accepted());
    vi.mocked(authApi.verifyRegistrationOtp).mockResolvedValue(ok(created));
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it("shows password problems next to the field and sends nothing", async () => {
    const user = renderPage();
    await fillDetails(user, { password: "lowercase1!" });
    await user.click(screen.getByRole("button", { name: /Gửi mã xác minh/ }));
    expect(screen.getByLabelText("Mật khẩu")).toHaveAccessibleDescription(/chữ hoa/);
    expect(authApi.requestRegistrationOtp).not.toHaveBeenCalled();
  });

  it("requires the confirmation to match", async () => {
    const user = renderPage();
    await fillDetails(user, { password: PASSWORD, confirmation: "Different1!" });
    await user.click(screen.getByRole("button", { name: /Gửi mã xác minh/ }));
    expect(screen.getByLabelText("Xác nhận mật khẩu")).toHaveAccessibleDescription("Mật khẩu xác nhận không khớp.");
    expect(authApi.requestRegistrationOtp).not.toHaveBeenCalled();
  });

  it("rejects an invalid email on the client", async () => {
    const user = renderPage();
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Mật khẩu"), PASSWORD);
    await user.type(screen.getByLabelText("Xác nhận mật khẩu"), PASSWORD);
    await user.click(screen.getByRole("button", { name: /Gửi mã xác minh/ }));
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Email không hợp lệ.");
  });

  it("toggles each password field independently", async () => {
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: "Hiện mật khẩu" }));
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Xác nhận mật khẩu")).toHaveAttribute("type", "password");
  });

  it("moves to the OTP step, then signs in and leaves the page after a correct code", async () => {
    const user = renderPage();
    await goToOtpStep(user);
    expect(authApi.requestRegistrationOtp).toHaveBeenCalledWith("new@example.com", PASSWORD);
    expect(screen.queryByLabelText("Mật khẩu")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Mã xác minh"), "123456");
    await user.click(screen.getByRole("button", { name: "Xác minh và đăng ký" }));
    expect(authApi.verifyRegistrationOtp).toHaveBeenCalledWith("new@example.com", "123456");
    expect(await screen.findByText("Trang cửa hàng")).toBeInTheDocument();
  });

  it("forgets the password once the code is sent, and keeps the email when going back", async () => {
    const user = renderPage();
    await goToOtpStep(user);
    await user.click(screen.getByRole("button", { name: "Đổi email hoặc mật khẩu" }));
    expect(screen.getByLabelText("Email")).toHaveValue("new@example.com");
    expect(screen.getByLabelText("Mật khẩu")).toHaveValue("");
    expect(screen.getByLabelText("Xác nhận mật khẩu")).toHaveValue("");
  });

  it("only accepts digits and keeps submit disabled until there are six", async () => {
    const user = renderPage();
    await goToOtpStep(user);
    const input = screen.getByLabelText("Mã xác minh");
    const submit = screen.getByRole("button", { name: "Xác minh và đăng ký" });
    await user.type(input, "12ab3");
    expect(input).toHaveValue("123");
    expect(submit).toBeDisabled();
    await user.type(input, "456");
    expect(submit).toBeEnabled();
  });

  it("counts the code lifetime down and blocks submit once it expires", async () => {
    const user = renderPage();
    await goToOtpStep(user);
    expect(screen.getByRole("timer")).toHaveTextContent("5:00");
    await advance(61);
    expect(screen.getByRole("timer")).toHaveTextContent("3:59");
    await user.type(screen.getByLabelText("Mã xác minh"), "123456");
    await advance(240);
    expect(screen.getByRole("timer")).toHaveTextContent("Mã đã hết hạn");
    expect(screen.getByRole("button", { name: "Xác minh và đăng ký" })).toBeDisabled();
  });

  it("follows the timings the server returns instead of fixed numbers", async () => {
    vi.mocked(authApi.requestRegistrationOtp).mockResolvedValue(accepted(120, 20));
    const user = renderPage();
    await goToOtpStep(user);
    expect(screen.getByRole("timer")).toHaveTextContent("2:00");
    expect(screen.getByRole("button", { name: "Gửi lại mã (20s)" })).toBeDisabled();
    await advance(20);
    expect(screen.getByRole("button", { name: "Gửi lại mã" })).toBeEnabled();
  });

  it("keeps resend disabled for exactly 60 seconds, then allows it and starts over", async () => {
    const user = renderPage();
    await goToOtpStep(user);
    const resend = () => screen.getByRole("button", { name: /Gửi lại mã/ });
    expect(resend()).toBeDisabled();
    expect(resend()).toHaveTextContent("Gửi lại mã (60s)");
    await advance(59);
    expect(resend()).toBeDisabled();
    await advance(1);
    expect(resend()).toBeEnabled();

    await user.click(resend());
    expect(authApi.resendRegistrationOtp).toHaveBeenCalledWith("new@example.com");
    expect(await screen.findByRole("button", { name: "Gửi lại mã (60s)" })).toBeDisabled();
    expect(screen.getByRole("timer")).toHaveTextContent("5:00");
  });

  it("uses Retry-After when resend is rate limited", async () => {
    vi.mocked(authApi.resendRegistrationOtp).mockRejectedValue(failure(429, { detail: "x" }, { "retry-after": "30" }));
    const user = renderPage();
    await goToOtpStep(user);
    await advance(60);
    await user.click(screen.getByRole("button", { name: /Gửi lại mã/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Vui lòng đợi 30 giây");
    expect(screen.getByRole("button", { name: "Gửi lại mã (30s)" })).toBeDisabled();
  });

  it("shows the wait time when the first request is rate limited", async () => {
    vi.mocked(authApi.requestRegistrationOtp).mockRejectedValue(failure(429, { detail: "x" }, { "retry-after": "42" }));
    const user = renderPage();
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: /Gửi mã xác minh/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("đợi 42 giây");
    expect(screen.getByLabelText("Email")).toBeInTheDocument(); // still on step one
  });

  it("shows the server's message for a wrong code and stays on the page", async () => {
    vi.mocked(authApi.verifyRegistrationOtp).mockRejectedValue(failure(400, { detail: "Mã OTP không đúng hoặc đã hết hạn." }));
    const user = renderPage();
    await goToOtpStep(user);
    await user.type(screen.getByLabelText("Mã xác minh"), "000000");
    await user.click(screen.getByRole("button", { name: "Xác minh và đăng ký" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mã OTP không đúng hoặc đã hết hạn.");
    expect(screen.queryByText("Trang cửa hàng")).not.toBeInTheDocument();
  });

  it("maps a server 422 to the password field", async () => {
    vi.mocked(authApi.requestRegistrationOtp).mockRejectedValue(
      failure(422, { detail: [{ loc: ["body", "password"], msg: "Mật khẩu phải có ít nhất 1 chữ số." }] }),
    );
    const user = renderPage();
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: /Gửi mã xác minh/ }));
    expect(await screen.findByText("Mật khẩu phải có ít nhất 1 chữ số.")).toBeInTheDocument();
  });

  it("links between login and registration", async () => {
    const user = renderPage("/login");
    await user.click(screen.getByRole("link", { name: "Đăng ký" }));
    expect(await screen.findByText("Tạo tài khoản", { selector: "h2" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Đăng nhập" }));
    expect(await screen.findByText("Chào mừng trở lại")).toBeInTheDocument();
  });
});
