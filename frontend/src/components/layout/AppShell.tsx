import type { ReactNode } from "react";
import {
  Boxes,
  KeyRound,
  LogIn,
  LogOut,
  PackageSearch,
  ShieldCheck,
  Tags,
  Users,
  Monitor,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { logout, user } = useAuth();
  const homePath = user?.role === "ADMIN" ? "/admin/products" : "/shop";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Bỏ qua điều hướng</a>
      <aside className="sidebar">
        <NavLink
          className="brand"
          to={homePath}
          aria-label="Product Catalog — Sản phẩm"
        >
          <span className="brand-mark">
            <Boxes size={20} aria-hidden="true" />
          </span>
          <span>Product Catalog</span>
        </NavLink>
        <nav aria-label="Điều hướng chính">
          {user?.role === "ADMIN" && (
            <NavLink className="nav-link" to="/admin/products">
              <PackageSearch size={18} aria-hidden="true" />
              Sản phẩm
            </NavLink>
          )}
          {user?.role === "ADMIN" && (
            <NavLink className="nav-link" to="/admin/categories">
              <Tags size={18} aria-hidden="true" />
              Danh mục
            </NavLink>
          )}
          {user && (
            <NavLink className="nav-link" to="/account/sessions">
              <Monitor size={18} aria-hidden="true" />
              Phiên đăng nhập
            </NavLink>
          )}
          {user && (
            <NavLink className="nav-link" to="/account/password">
              <KeyRound size={18} aria-hidden="true" />
              Đổi mật khẩu
            </NavLink>
          )}
          {user?.role === "ADMIN" && (
            <NavLink className="nav-link" to="/admin/users">
              <Users size={18} aria-hidden="true" />
              Quản lý người dùng
            </NavLink>
          )}
        </nav>
        <div className="sidebar-note">
          {user ? (
            <>
              <span>
                <ShieldCheck size={14} aria-hidden="true" />{" "}
                {user.role === "ADMIN" ? "Quản trị viên" : "Người dùng"}
              </span>
              <small>{user.email}</small>
              <button type="button" onClick={() => void logout()}>
                <LogOut size={14} aria-hidden="true" /> Đăng xuất
              </button>
            </>
          ) : (
            <NavLink to="/login">
              <LogIn size={14} aria-hidden="true" /> Đăng nhập
            </NavLink>
          )}
        </div>
      </aside>
      <main id="main-content" className="page-content">{children}</main>
    </div>
  );
}
