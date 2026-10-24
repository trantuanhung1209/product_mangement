import { useEffect, useState } from "react";
import { ChevronRight, Search, Users } from "lucide-react";
import { Link } from "react-router-dom";
import * as authApi from "../api/auth";
import { useToast } from "../components/feedback/Toast";
import type { AdminUserList } from "../types/catalog";

export function AdminUsersPage() {
  const { showToast } = useToast();
  const [data, setData] = useState<AdminUserList>();
  const [search, setSearch] = useState("");
  const load = () =>
    void authApi
      .getAdminUsers({ page: 1, page_size: 20, search: search || undefined })
      .then((response) => setData(response.data))
      .catch(() => showToast("Không thể tải người dùng.", "error"));
  useEffect(load, []);
  return (
    <>
      <header className="page-header">
        <div className="breadcrumb">
          <span>Quản trị</span>
          <ChevronRight size={14} aria-hidden="true" />
          <strong>Người dùng</strong>
        </div>
        <h1>Quản lý người dùng</h1>
        <p>Xem và thu hồi phiên đăng nhập khi cần thiết.</p>
      </header>
      <div className="filters admin-search">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm theo email"
          />
        </label>
        <button className="secondary-button" onClick={load}>
          Tìm kiếm
        </button>
      </div>
      {!data ? (
        <section className="state-panel">
          <p>Đang tải người dùng...</p>
        </section>
      ) : (
        <div className="table-wrap">
          <table className="product-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((user) => (
                <tr key={user.id}>
                  <td data-label="Email">
                    <strong>{user.email}</strong>
                  </td>
                  <td data-label="Vai trò">
                    <span className="role-badge">{user.role}</span>
                  </td>
                  <td data-label="Trạng thái">
                    {user.is_active ? "Đang hoạt động" : "Đã khóa"}
                  </td>
                  <td>
                    <Link
                      className="secondary-button button-link"
                      to={`/admin/users/${user.id}/sessions`}
                    >
                      {" "}
                      <Users size={15} aria-hidden="true" /> Xem phiên
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
