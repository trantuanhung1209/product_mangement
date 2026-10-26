import { useState } from "react";
import { ChevronRight, Search, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useAdminUsers } from "../hooks/useAdminUsers";

export function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const { data, error, retry } = useAdminUsers({ page: 1, page_size: 20, search: appliedSearch || undefined });
  const applySearch = () => (search === appliedSearch ? retry() : setAppliedSearch(search));
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
        <button className="secondary-button" onClick={applySearch}>
          Tìm kiếm
        </button>
      </div>
      {error ? (
        <section className="state-panel">
          <h2>Không thể tải người dùng</h2>
          <button type="button" className="primary-button" onClick={retry}>Thử lại</button>
        </section>
      ) : !data ? (
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
