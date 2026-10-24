import type { ReactNode } from "react";
import { Leaf, LogIn } from "lucide-react";
import { Link, NavLink } from "react-router-dom";

interface StorefrontShellProps {
  children: ReactNode;
}

export function StorefrontShell({ children }: StorefrontShellProps) {
  return <div className="storefront-shell">
    <a className="skip-link" href="#main-content">Bỏ qua điều hướng</a>
    <header className="storefront-header"><div className="storefront-container storefront-nav">
      <Link className="storefront-brand" to="/"><Leaf size={21} aria-hidden="true" /><span>Product Catalog</span></Link>
      <nav aria-label="Điều hướng cửa hàng"><NavLink to="/">Trang chủ</NavLink><NavLink to="/shop">Sản phẩm</NavLink></nav>
      <div className="storefront-actions"><Link className="storefront-login" to="/login"><LogIn size={16} aria-hidden="true" /> Đăng nhập</Link></div>
    </div></header>
    <main id="main-content">{children}</main>
    <footer className="storefront-footer"><div className="storefront-container"><Link className="storefront-brand" to="/"><Leaf size={19} aria-hidden="true" /><span>Product Catalog</span></Link><p>Khám phá sản phẩm phù hợp cho công việc và cuộc sống mỗi ngày.</p><Link to="/shop">Xem sản phẩm</Link></div></footer>
  </div>;
}
