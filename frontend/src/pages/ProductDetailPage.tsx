import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { ArrowLeft, ChevronRight, ImageOff, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { getCategories } from "../api/categories";
import { deleteProduct, getProduct } from "../api/products";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { useToast } from "../components/feedback/Toast";
import type { Category, Product } from "../types/catalog";
import { formatDate, formatNumber, formatPrice } from "../utils/format";

export function ProductDetailPage() {
  const { productId } = useParams();
  const productIdNumber = Number(productId);
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [product, setProduct] = useState<Product>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!Number.isInteger(productIdNumber) || productIdNumber <= 0) {
      setError(true);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void Promise.all([getProduct(productIdNumber, controller.signal), getCategories(controller.signal)])
      .then(([productResponse, categoriesResponse]) => {
        setProduct(productResponse.data);
        setCategories(categoriesResponse.data);
      })
      .catch((requestError: unknown) => {
        if (!(isAxiosError(requestError) && requestError.code === "ERR_CANCELED")) setError(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [productIdNumber]);

  const backToList = () => navigate(`/products${location.search}`);
  const handleDelete = async () => {
    if (!product) return;
    setDeleting(true);
    try {
      await deleteProduct(product.id);
      showToast("Đã xóa sản phẩm.");
      navigate(`/products${location.search}`, { replace: true });
    } catch {
      showToast("Không thể xóa sản phẩm. Vui lòng thử lại.", "error");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  if (loading) return <section className="state-panel"><LoaderCircle className="spin" size={26} aria-hidden="true" /><h2>Đang tải sản phẩm</h2><p>Vui lòng chờ trong giây lát.</p></section>;
  if (error || !product) return <section className="state-panel"><h2>Không tìm thấy sản phẩm</h2><p>Sản phẩm có thể đã bị xóa hoặc đường dẫn không hợp lệ.</p><button type="button" className="primary-button" onClick={backToList}>Về danh sách</button></section>;

  const categoryName = categories.find((category) => category.id === product.category_id)?.name ?? "Danh mục chưa xác định";
  return <><header className="page-header"><div className="breadcrumb"><Link to={`/products${location.search}`}>Sản phẩm</Link><ChevronRight size={14} aria-hidden="true" /><strong>{product.name}</strong></div><div className="page-heading-row"><div><h1>Chi tiết sản phẩm</h1><p>Xem thông tin và quản lý sản phẩm trong danh mục.</p></div><button type="button" className="back-button" onClick={backToList}><ArrowLeft size={16} aria-hidden="true" /> Quay lại</button></div></header><section className="product-detail"><div className="detail-image">{product.image_url ? <img src={product.image_url} alt={product.name} /> : <span><ImageOff size={34} aria-hidden="true" /> Chưa có hình ảnh</span>}</div><div className="detail-content"><div className="detail-topline"><span className={product.stock > 0 ? "stock stock-available" : "stock stock-empty"}>{product.stock > 0 ? `Còn ${formatNumber(product.stock)}` : "Hết hàng"}</span><span className="detail-category">{categoryName}</span></div><h2>{product.name}</h2><p className="detail-price">{formatPrice(product.price)}</p><p className="detail-description">{product.description || "Sản phẩm chưa có mô tả."}</p><dl className="detail-meta"><div><dt>Tồn kho</dt><dd>{formatNumber(product.stock)} sản phẩm</dd></div><div><dt>Ngày tạo</dt><dd>{formatDate(product.created_at)}</dd></div><div><dt>Cập nhật lần cuối</dt><dd>{formatDate(product.updated_at)}</dd></div></dl><div className="detail-actions"><Link className="primary-button button-link" to={`/products/${product.id}/edit${location.search}`}><Pencil size={16} aria-hidden="true" /> Chỉnh sửa</Link><button type="button" className="danger-button" onClick={() => setConfirmingDelete(true)}><Trash2 size={16} aria-hidden="true" /> Xóa sản phẩm</button></div></div></section>{confirmingDelete && <ConfirmDialog busy={deleting} title="Xóa sản phẩm này?" description={`“${product.name}” sẽ bị xóa vĩnh viễn và không thể khôi phục.`} onCancel={() => setConfirmingDelete(false)} onConfirm={() => void handleDelete()} />}</>;
}
