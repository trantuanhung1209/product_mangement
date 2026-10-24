import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { ArrowLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { getCategories } from "../api/categories";
import { createProduct, getProduct, updateProduct, uploadProductImage } from "../api/products";
import { ProductForm } from "../components/products/ProductForm";
import { useToast } from "../components/feedback/Toast";
import type { Category, Product, ProductPayload } from "../types/catalog";

interface ProductFormPageProps {
  mode: "create" | "edit";
}

export function ProductFormPage({ mode }: ProductFormPageProps) {
  const { productId } = useParams();
  const productIdNumber = Number(productId);
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [product, setProduct] = useState<Product>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (mode === "edit" && (!Number.isInteger(productIdNumber) || productIdNumber <= 0)) {
      setError(true);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const productRequest = mode === "edit" ? getProduct(productIdNumber, controller.signal) : Promise.resolve(null);
    void Promise.all([getCategories(controller.signal), productRequest])
      .then(([categoriesResponse, productResponse]) => {
        setCategories(categoriesResponse.data);
        if (productResponse) setProduct(productResponse.data);
      })
      .catch((requestError: unknown) => {
        if (!(isAxiosError(requestError) && requestError.code === "ERR_CANCELED")) setError(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [mode, productIdNumber]);

  const backToList = () => navigate(`/products${location.search}`);
  const saveProduct = async (payload: ProductPayload, file: File | null, signal: AbortSignal) => {
    const response = mode === "create" ? await createProduct(payload, signal) : await updateProduct(productIdNumber, payload, signal);
    if (file) await uploadProductImage(response.data.id, file, signal);
    showToast(mode === "create" ? "Đã thêm sản phẩm mới." : "Đã cập nhật sản phẩm.");
    navigate(`/products/${response.data.id}${location.search}`, { replace: true });
  };

  if (loading) return <section className="state-panel"><LoaderCircle className="spin" size={26} aria-hidden="true" /><h2>Đang tải biểu mẫu</h2><p>Vui lòng chờ trong giây lát.</p></section>;
  if (error || (mode === "edit" && !product)) return <section className="state-panel"><h2>Không thể tải dữ liệu sản phẩm</h2><p>Sản phẩm có thể đã bị xóa hoặc kết nối gặp sự cố.</p><button type="button" className="primary-button" onClick={backToList}>Về danh sách</button></section>;

  const title = mode === "create" ? "Thêm sản phẩm" : "Chỉnh sửa sản phẩm";
  return <><header className="page-header"><div className="breadcrumb"><Link to={`/products${location.search}`}>Sản phẩm</Link><ChevronRight size={14} aria-hidden="true" /><strong>{title}</strong></div><div className="page-heading-row"><div><h1>{title}</h1><p>{mode === "create" ? "Điền thông tin để thêm sản phẩm vào danh mục." : "Cập nhật thông tin sản phẩm và lưu thay đổi."}</p></div><button type="button" className="back-button" onClick={backToList}><ArrowLeft size={16} aria-hidden="true" /> Quay lại</button></div></header><ProductForm categories={categories} initialProduct={product} onCancel={backToList} onSubmit={saveProduct} submitLabel={mode === "create" ? "Thêm sản phẩm" : "Lưu thay đổi"} /></>;
}
