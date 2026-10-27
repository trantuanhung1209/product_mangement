import { useState } from "react";
import { LoaderCircle, ShoppingBag, Trash2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { apiAssetUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useCart } from "../cart/CartContext";
import { QuantityControl } from "../components/storefront/QuantityControl";
import { useToast } from "../components/feedback/Toast";
import type { CartItem } from "../types/catalog";
import { defaultProductImage } from "../utils/defaultProductImage";
import { formatPrice } from "../utils/format";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function CartPage() {
  useDocumentTitle("Giỏ hàng");
  const { user } = useAuth();
  const { cart, loading, error, refresh, clear } = useCart();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [clearing, setClearing] = useState(false);

  if (!user) {
    return (
      <section className="storefront-container store-state cart-guest">
        <ShoppingBag size={30} aria-hidden="true" />
        <h1>Đăng nhập để xem giỏ hàng</h1>
        <p>Giỏ hàng được lưu an toàn theo tài khoản của bạn.</p>
        <button type="button" onClick={() => navigate("/login", { state: { from: `${location.pathname}${location.search}` } })}>
          Đăng nhập
        </button>
      </section>
    );
  }
  const clearItems = async () => {
    setClearing(true);
    try {
      await clear();
      showToast("Đã xóa toàn bộ sản phẩm khỏi giỏ hàng.");
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : "Không thể xóa giỏ hàng.", "error");
    } finally {
      setClearing(false);
    }
  };
  if (loading) return <CartLoading />;
  if (error && cart.items.length === 0) {
    return <section className="storefront-container store-state"><h1>Không thể tải giỏ hàng</h1><p role="alert">{error}</p><button type="button" onClick={() => void refresh().catch(() => undefined)}>Thử lại</button></section>;
  }
  if (cart.items.length === 0) {
    return <section className="storefront-container store-state"><ShoppingBag size={30} aria-hidden="true" /><h1>Giỏ hàng đang trống</h1><p>Hãy khám phá catalog và thêm sản phẩm phù hợp với bạn.</p><Link className="store-primary" to="/shop" style={{ color: "#fff" }}>Xem sản phẩm</Link></section>;
  }
  return (
    <section className="storefront-container cart-page">
      <header className="cart-heading"><div><p className="store-kicker"><ShoppingBag size={15} aria-hidden="true" /> Giỏ hàng</p><h1>Sản phẩm bạn đã chọn</h1><p>{cart.total_quantity} sản phẩm trong giỏ hàng.</p></div><button className="cart-clear" type="button" onClick={clearItems} disabled={clearing}>{clearing ? "Đang xóa..." : "Xóa tất cả"}</button></header>
      {error && <p className="cart-inline-error" role="alert">{error}</p>}
      <div className="cart-layout"><div className="cart-items">{cart.items.map((item) => <CartRow key={item.product_id} item={item} />)}</div><aside className="cart-summary"><h2>Tóm tắt đơn hàng</h2><dl><div><dt>Tổng số lượng</dt><dd>{cart.total_quantity}</dd></div><div><dt>Tạm tính</dt><dd>{formatPrice(cart.subtotal)}</dd></div></dl><p>Giá và tồn kho được cập nhật trực tiếp từ catalog.</p><Link className="store-secondary" to="/shop">Tiếp tục mua sắm</Link></aside></div>
    </section>
  );
}

function CartRow({ item }: { item: CartItem }) {
  const { updateItem, removeItem } = useCart();
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  const updateQuantity = async (quantity: number) => {
    if (quantity === item.quantity) return;
    setPending(true);
    try { await updateItem(item.product_id, quantity); } catch (requestError) { showToast(requestError instanceof Error ? requestError.message : "Không thể cập nhật số lượng.", "error"); } finally { setPending(false); }
  };
  const remove = async () => {
    setPending(true);
    try { await removeItem(item.product_id); showToast(`Đã xóa ${item.name} khỏi giỏ hàng.`); } catch (requestError) { showToast(requestError instanceof Error ? requestError.message : "Không thể xóa sản phẩm.", "error"); } finally { setPending(false); }
  };
  const canUpdate = item.available_stock > 0;
  return <article className="cart-row"><Link className="cart-image" to={`/shop/${item.product_id}`}>{item.image_url ? <img src={apiAssetUrl(item.image_url)} alt={item.name} /> : <img src={defaultProductImage(item.product_id)} alt={item.name} data-default-image="true" />}</Link><div className="cart-item-copy"><h2><Link to={`/shop/${item.product_id}`}>{item.name}</Link></h2><p>{formatPrice(item.unit_price)} / sản phẩm</p>{!item.is_available && <span className="cart-stock-warning" role="alert">Tồn kho hiện tại chỉ còn {item.available_stock}.</span>}</div><QuantityControl value={item.quantity} max={Math.max(1, item.available_stock)} disabled={pending || !canUpdate} onChange={updateQuantity} /><strong>{formatPrice(item.line_total)}</strong><button className="cart-remove" type="button" onClick={remove} disabled={pending} aria-label={`Xóa ${item.name} khỏi giỏ hàng`}><Trash2 size={18} aria-hidden="true" /></button></article>;
}

function CartLoading() {
  return <section className="storefront-container cart-page" aria-busy="true"><header className="cart-heading"><div><p className="store-kicker">Giỏ hàng</p><h1>Đang tải giỏ hàng</h1></div></header><div className="cart-loading"><LoaderCircle className="spin" size={24} aria-hidden="true" /><span>Đang đồng bộ giỏ hàng.</span></div></section>;
}
