import { ImageOff, PackageOpen, RefreshCw } from "lucide-react";

import type { Category, Product } from "../../types/catalog";
import { formatDate, formatNumber, formatPrice } from "../../utils/format";

interface ProductTableProps {
  categories: Category[];
  error: boolean;
  hasFilters: boolean;
  loading: boolean;
  products: Product[];
  onRetry: () => void;
}

export function ProductTable({ categories, error, hasFilters, loading, products, onRetry }: ProductTableProps) {
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  if (loading) return <ProductSkeleton />;
  if (error) return <section className="state-panel"><RefreshCw size={26} aria-hidden="true" /><h2>Không thể tải danh sách sản phẩm</h2><p>Kiểm tra kết nối rồi thử lại.</p><button type="button" className="primary-button" onClick={onRetry}>Thử lại</button></section>;
  if (!products.length) return <section className="state-panel"><PackageOpen size={28} aria-hidden="true" /><h2>{hasFilters ? "Không tìm thấy sản phẩm" : "Chưa có sản phẩm nào"}</h2><p>{hasFilters ? "Hãy thử thay đổi từ khóa hoặc bộ lọc." : "Sản phẩm sẽ xuất hiện ở đây khi được thêm vào hệ thống."}</p></section>;

  return <div className="table-wrap"><table className="product-table"><thead><tr><th>Sản phẩm</th><th>Danh mục</th><th>Giá bán</th><th>Tồn kho</th><th>Ngày tạo</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td data-label="Sản phẩm"><div className="product-identity">{product.image_url ? <img src={product.image_url} alt="" /> : <span className="image-placeholder"><ImageOff size={19} aria-label="Chưa có ảnh" /></span>}<div><strong>{product.name}</strong>{product.description && <small>{product.description}</small>}</div></div></td><td data-label="Danh mục">{categoryNames.get(product.category_id) ?? "Danh mục chưa xác định"}</td><td data-label="Giá bán" className="numeric">{formatPrice(product.price)}</td><td data-label="Tồn kho"><span className={product.stock > 0 ? "stock stock-available" : "stock stock-empty"}>{product.stock > 0 ? `Còn ${formatNumber(product.stock)}` : "Hết hàng"}</span></td><td data-label="Ngày tạo" className="muted-cell">{formatDate(product.created_at)}</td></tr>)}</tbody></table></div>;
}

function ProductSkeleton() {
  return <div className="table-wrap skeleton-table" aria-label="Đang tải sản phẩm"><div className="skeleton-head" />{Array.from({ length: 6 }, (_, index) => <div className="skeleton-row" key={index}><span /><span /><span /><span /></div>)}</div>;
}
