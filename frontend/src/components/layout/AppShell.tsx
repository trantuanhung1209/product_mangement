import type { ReactNode } from "react";
import { Boxes, PackageSearch } from "lucide-react";
import { NavLink } from "react-router-dom";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink className="brand" to="/products" aria-label="Product Catalog — Sản phẩm">
          <span className="brand-mark"><Boxes size={20} aria-hidden="true" /></span>
          <span>Product Catalog</span>
        </NavLink>
        <nav aria-label="Điều hướng chính">
          <NavLink className="nav-link" to="/products">
            <PackageSearch size={18} aria-hidden="true" />
            Sản phẩm
          </NavLink>
        </nav>
        <p className="sidebar-note">Danh mục sản phẩm<br />được cập nhật theo thời gian thực.</p>
      </aside>
      <main className="page-content">{children}</main>
    </div>
  );
}
