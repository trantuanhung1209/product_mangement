import { ImageOff, PackageCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { apiAssetUrl } from "../../api/client";
import type { Product } from "../../types/catalog";
import { formatPrice } from "../../utils/format";

interface StoreProductCardProps {
  categoryName?: string;
  product: Product;
}

export function StoreProductCard({ categoryName, product }: StoreProductCardProps) {
  return <article className="store-product-card"><Link className="store-product-image" to={`/shop/${product.id}`} aria-label={`Xem ${product.name}`}>
    {product.image_url ? <img src={apiAssetUrl(product.image_url)} alt={product.name} loading="lazy" /> : <span><ImageOff size={28} aria-hidden="true" /> Chưa có ảnh</span>}
  </Link><div className="store-product-copy"><p>{categoryName ?? "Danh mục sản phẩm"}</p><h3><Link to={`/shop/${product.id}`}>{product.name}</Link></h3><strong>{formatPrice(product.price)}</strong><span className={product.stock > 0 ? "store-stock" : "store-stock store-stock-empty"}><PackageCheck size={14} aria-hidden="true" />{product.stock > 0 ? "Còn hàng" : "Tạm hết hàng"}</span></div></article>;
}
