import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Leaf, LogIn, LogOut, ShoppingCart, UserRound } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";
import { useCart } from "../../cart/CartContext";
import { useToast } from "../feedback/Toast";

interface StorefrontShellProps {
  children: ReactNode;
}

export function StorefrontShell({ children }: StorefrontShellProps) {
  const { cart } = useCart();
  const { logout, user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();
  // The account menu is a <details>, which stays open until toggled again. Close it when the user
  // picks a destination, clicks elsewhere or presses Escape.
  useEffect(() => {
    if (menuRef.current) menuRef.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menu.open) return;
      menu.open = false;
      menu.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [user]);
  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/", { replace: true });
    } catch {
      showToast("Không thể đăng xuất. Vui lòng thử lại.", "error");
    } finally {
      setLoggingOut(false);
    }
  };
  return <div className="storefront-shell">
    <a className="skip-link" href="#main-content">Bỏ qua điều hướng</a>
    <header className="storefront-header"><div className="storefront-container storefront-nav">
      <Link className="storefront-brand" to="/"><Leaf size={21} aria-hidden="true" /><span>Product Catalog</span></Link>
      <nav aria-label="Điều hướng cửa hàng"><NavLink to="/">Trang chủ</NavLink><NavLink to="/shop">Sản phẩm</NavLink></nav>
      <div className="storefront-actions">
        <Link className="storefront-cart" to="/cart" aria-label={`Giỏ hàng, ${cart.total_quantity} sản phẩm`}>
          <ShoppingCart size={18} aria-hidden="true" />
          <span>Giỏ hàng</span>
          {cart.total_quantity > 0 && <b aria-hidden="true">{cart.total_quantity}</b>}
        </Link>
        {user ? (
          <details ref={menuRef} className="storefront-user-menu">
            <summary aria-label="Mở menu tài khoản">
              <UserRound size={17} aria-hidden="true" />
              <span>Tài khoản</span>
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <div className="storefront-user-popover">
              <strong>{user.email}</strong>
              <small>{user.role === "ADMIN" ? "Quản trị viên" : "Người dùng"}</small>
              <Link to="/account/sessions">Quản lý phiên đăng nhập</Link>
              <button type="button" onClick={() => void handleLogout()} disabled={loggingOut}>
                <LogOut size={15} aria-hidden="true" />
                {loggingOut ? "Đang đăng xuất..." : "Đăng xuất"}
              </button>
            </div>
          </details>
        ) : (
          <Link className="storefront-login" to="/login"><LogIn size={16} aria-hidden="true" /> Đăng nhập</Link>
        )}
      </div>
    </div></header>
    <main id="main-content">{children}</main>
    <footer className="storefront-footer"><div className="storefront-container"><Link className="storefront-brand" to="/"><Leaf size={19} aria-hidden="true" /><span>Product Catalog</span></Link><p>Khám phá sản phẩm phù hợp cho công việc và cuộc sống mỗi ngày.</p><Link to="/shop">Xem sản phẩm</Link></div></footer>
  </div>;
}
