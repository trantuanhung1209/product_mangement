import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import { adminKeys, sessionKeys } from "../api/queryKeys";
import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../components/feedback/Toast";
import { createTestQueryClient, ok } from "../test/testUtils";
import type { AdminUser, AuthUser, LoginSession } from "../types/catalog";
import { AdminUserSessionsPage } from "./AdminUserSessionsPage";
import { AdminUsersPage } from "./AdminUsersPage";
import { SessionsPage } from "./SessionsPage";

vi.mock("../api/auth");

const me: AuthUser = { id: 1, email: "me@example.com", role: "ADMIN", is_active: true, created_at: "2026-01-01T00:00:00Z" };
const session = (id: string, isCurrent = false): LoginSession => ({
  session_id: id,
  created_at: "2026-01-01T00:00:00Z",
  last_active_at: "2026-01-01T00:00:00Z",
  expires_at: "2026-01-08T00:00:00Z",
  user_agent: `agent-${id}`,
  is_current: isCurrent,
});
const adminUser = (id: number, email: string): AdminUser => ({ id, email, role: "USER", is_active: true });
const failure = () => new AxiosError("failed", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as AxiosResponse);

function renderAt(path: string) {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/account/sessions" element={<SessionsPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/users/:userId/sessions" element={<AdminUserSessionsPage />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
const confirm = () => userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Thu hồi phiên|Đăng xuất các thiết bị/ }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.getCurrentUser).mockResolvedValue(ok(me));
});

describe("SessionsPage", () => {
  it("lists the user's sessions under a per-user key", async () => {
    vi.mocked(authApi.getSessions).mockResolvedValue(ok([session("a", true), session("b")]));
    const client = renderAt("/account/sessions");
    expect(await screen.findByText("agent-b")).toBeInTheDocument();
    expect(client.getQueryData(sessionKeys.mine(1))).toHaveLength(2);
  });

  it("revoking another session calls the API and refetches the list", async () => {
    vi.mocked(authApi.getSessions).mockResolvedValueOnce(ok([session("a", true), session("b")])).mockResolvedValue(ok([session("a", true)]));
    vi.mocked(authApi.revokeSession).mockResolvedValue(ok(undefined));
    renderAt("/account/sessions");
    await screen.findByText("agent-b");

    await userEvent.click(screen.getByRole("button", { name: "Thu hồi" }));
    await confirm();

    await waitFor(() => expect(screen.queryByText("agent-b")).not.toBeInTheDocument());
    expect(authApi.revokeSession).toHaveBeenCalledWith("b");
    expect(screen.getByText("Đã thu hồi phiên đăng nhập.")).toBeInTheDocument();
  });

  it("revoking all other sessions reports the count and refetches", async () => {
    vi.mocked(authApi.getSessions).mockResolvedValueOnce(ok([session("a", true), session("b")])).mockResolvedValue(ok([session("a", true)]));
    vi.mocked(authApi.revokeOtherSessions).mockResolvedValue(ok({ revoked_count: 1 }));
    renderAt("/account/sessions");
    await screen.findByText("agent-b");

    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất thiết bị khác" }));
    await confirm();

    expect(await screen.findByText("Đã đăng xuất 1 thiết bị khác.")).toBeInTheDocument();
    await waitFor(() => expect(authApi.getSessions).toHaveBeenCalledTimes(2));
  });

  it("revoking the current session logs out", async () => {
    vi.mocked(authApi.getSessions).mockResolvedValue(ok([session("a", true)]));
    vi.mocked(authApi.revokeSession).mockResolvedValue(ok(undefined));
    vi.mocked(authApi.logout).mockResolvedValue(ok(undefined));
    renderAt("/account/sessions");
    await screen.findByText("agent-a");

    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    await confirm();

    await waitFor(() => expect(authApi.logout).toHaveBeenCalledTimes(1));
    expect(authApi.revokeSession).toHaveBeenCalledWith("a");
  });

  it("a failed revoke shows an error and does not refetch; a load error offers retry", async () => {
    vi.mocked(authApi.getSessions).mockRejectedValueOnce(failure()).mockResolvedValue(ok([session("a", true), session("b")]));
    renderAt("/account/sessions");
    await screen.findByText("Không thể tải phiên đăng nhập");
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("agent-b");

    vi.mocked(authApi.revokeSession).mockRejectedValue(failure());
    await userEvent.click(screen.getByRole("button", { name: "Thu hồi" }));
    await confirm();

    expect(await screen.findByText("Không thể thu hồi phiên. Vui lòng thử lại.")).toBeInTheDocument();
    expect(authApi.getSessions).toHaveBeenCalledTimes(2);
  });
});

describe("AdminUsersPage", () => {
  it("lists users, and searches only when the button is pressed, with its own cache entry", async () => {
    vi.mocked(authApi.getAdminUsers).mockImplementation(async (params) =>
      ok({ items: params.search ? [adminUser(2, "found@example.com")] : [adminUser(3, "first@example.com")], total: 1, page: 1, page_size: 20, total_pages: 1 }),
    );
    const client = renderAt("/admin/users");
    expect(await screen.findByText("first@example.com")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Tìm theo email"), "found");
    expect(authApi.getAdminUsers).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Tìm kiếm" }));

    expect(await screen.findByText("found@example.com")).toBeInTheDocument();
    expect(screen.queryByText("first@example.com")).not.toBeInTheDocument();
    expect(authApi.getAdminUsers).toHaveBeenLastCalledWith({ page: 1, page_size: 20, search: "found" }, expect.any(AbortSignal));
    expect(client.getQueryCache().findAll({ queryKey: adminKeys.users() })).toHaveLength(2);
  });

  it("tells the admin when there are no users, and when a search finds none", async () => {
    vi.mocked(authApi.getAdminUsers).mockResolvedValue(ok({ items: [], total: 0, page: 1, page_size: 20, total_pages: 0 }));
    renderAt("/admin/users");
    expect(await screen.findByText("Chưa có người dùng nào")).toBeInTheDocument();

    expect(screen.getByRole("textbox", { name: "Tìm theo email" })).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Tìm theo email"), "nobody");
    await userEvent.click(screen.getByRole("button", { name: "Tìm kiếm" }));
    expect(await screen.findByText("Không tìm thấy người dùng")).toBeInTheDocument();
  });

  it("shows an error with retry instead of loading forever", async () => {
    vi.mocked(authApi.getAdminUsers).mockRejectedValueOnce(failure()).mockResolvedValue(ok({ items: [adminUser(3, "ok@example.com")], total: 1, page: 1, page_size: 20, total_pages: 1 }));
    renderAt("/admin/users");
    await screen.findByText("Không thể tải người dùng");
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("ok@example.com")).toBeInTheDocument();
  });
});

describe("AdminUserSessionsPage", () => {
  const detail = (sessions: LoginSession[]) => ok({ user: adminUser(5, "target@example.com") as AuthUser, active_session_count: sessions.length, sessions });

  it("revoking one session refetches that user's sessions", async () => {
    vi.mocked(authApi.getAdminUserSessions).mockResolvedValueOnce(detail([session("x"), session("y")])).mockResolvedValue(detail([session("y")]));
    vi.mocked(authApi.revokeAdminSession).mockResolvedValue(ok(undefined));
    renderAt("/admin/users/5/sessions");
    await screen.findByText("agent-x");

    await userEvent.click(screen.getAllByRole("button", { name: "Thu hồi" })[0]);
    await confirm();

    await waitFor(() => expect(screen.queryByText("agent-x")).not.toBeInTheDocument());
    expect(authApi.revokeAdminSession).toHaveBeenCalledWith("5", "x");
    expect(authApi.getAdminUserSessions).toHaveBeenLastCalledWith("5", expect.any(AbortSignal));
  });

  it("revoking all reports the count and refetches", async () => {
    vi.mocked(authApi.getAdminUserSessions).mockResolvedValueOnce(detail([session("x"), session("y")])).mockResolvedValue(detail([]));
    vi.mocked(authApi.revokeAllAdminSessions).mockResolvedValue(ok({ revoked_count: 2 }));
    renderAt("/admin/users/5/sessions");
    await screen.findByText("agent-x");

    await userEvent.click(screen.getByRole("button", { name: "Thu hồi tất cả" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Thu hồi phiên" }));

    expect(await screen.findByText("Đã thu hồi 2 phiên.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("agent-x")).not.toBeInTheDocument());
  });

  it("says so when the user has no active sessions", async () => {
    vi.mocked(authApi.getAdminUserSessions).mockResolvedValue(detail([]));
    renderAt("/admin/users/5/sessions");
    expect(await screen.findByText("Không có phiên đang hoạt động")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thu hồi tất cả" })).toBeDisabled();
  });

  it("a failed revoke shows an error and does not refetch; load errors offer retry", async () => {
    vi.mocked(authApi.getAdminUserSessions).mockRejectedValueOnce(failure()).mockResolvedValue(detail([session("x")]));
    renderAt("/admin/users/5/sessions");
    await screen.findByText("Không thể tải phiên người dùng");
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("agent-x");

    vi.mocked(authApi.revokeAdminSession).mockRejectedValue(failure());
    await userEvent.click(screen.getAllByRole("button", { name: "Thu hồi" })[0]);
    await confirm();

    expect(await screen.findByText("Không thể thu hồi phiên.")).toBeInTheDocument();
    expect(authApi.getAdminUserSessions).toHaveBeenCalledTimes(2);
  });
});
