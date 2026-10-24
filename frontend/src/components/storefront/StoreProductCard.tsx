import { ImageOff, PackageCheck, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { apiAssetUrl } from "../../api/client";
import { useCart } from "../../cart/CartContext";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../feedback/Toast";
import type { Product } from "../../types/catalog";
import { formatPrice } from "../../utils/format";

interface StoreProductCardProps {
  categoryName?: string;
  product: Product;
}

export function StoreProductCard({ categoryName, product }: StoreProductCardProps) {
  const { addItem } = useCart();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [adding, setAdding] = useState(false);
  const addToCart = async () => {
    if (!user) {
      navigate("/login", { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    setAdding(true);
    try {
      await addItem(product.id, 1);
      showToast(`Đã thêm ${product.name} vào giỏ hàng.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể thêm vào giỏ hàng.", "error");
    } finally {
      setAdding(false);
    }
  };
  return <article className="store-product-card"><Link className="store-product-image" to={`/shop/${product.id}`} aria-label={`Xem ${product.name}`}>
    {product.image_url ? <img src={apiAssetUrl(product.image_url)} alt={product.name} loading="lazy" /> : <span><ImageOff size={28} aria-hidden="true" /> Chưa có ảnh</span>}
  </Link><div className="store-product-copy"><p>{categoryName ?? "Danh mục sản phẩm"}</p><h3><Link to={`/shop/${product.id}`}>{product.name}</Link></h3><strong>{formatPrice(product.price)}</strong><span className={product.stock > 0 ? "store-stock" : "store-stock store-stock-empty"}><PackageCheck size={14} aria-hidden="true" />{product.stock > 0 ? "Còn hàng" : "Tạm hết hàng"}</span><button className="store-add-cart" type="button" onClick={addToCart} disabled={adding || product.stock <= 0}>{adding ? "Đang thêm..." : <><ShoppingCart size={16} aria-hidden="true" /> Thêm vào giỏ</>}</button></div></article>;
}
