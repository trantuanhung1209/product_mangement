import { ArrowLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { ProductForm } from "../components/products/ProductForm";
import { useToast } from "../components/feedback/Toast";
import { useCategories } from "../hooks/useCategories";
import { useProduct } from "../hooks/useProduct";
import { useSaveProduct } from "../hooks/useProductMutations";
import type { ProductPayload } from "../types/catalog";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

interface ProductFormPageProps {
  mode: "create" | "edit";
}

export function ProductFormPage({ mode }: ProductFormPageProps) {
  useDocumentTitle(mode === "create" ? "Thêm sản phẩm" : "Sửa sản phẩm");
  const { productId } = useParams();
  const productIdNumber = Number(productId);
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isEdit = mode === "edit";
  const productQuery = useProduct(isEdit ? productIdNumber : 0, { freshForEdit: true });
  const categoriesQuery = useCategories();
  const saveMutation = useSaveProduct(isEdit ? productIdNumber : undefined);
  const product = isEdit ? productQuery.product : undefined;
  const loading = categoriesQuery.loading || (isEdit && productQuery.loading);
  const notFound = isEdit && productQuery.notFound;
  const loadFailed = categoriesQuery.error || (isEdit && productQuery.error && !notFound);
  const retryLoad = () => {
    categoriesQuery.retry();
    if (isEdit) productQuery.retry();
  };

  const backToList = () => navigate(`/admin/products${location.search}`);
  const saveProduct = async (
    payload: ProductPayload,
    file: File | null,
    signal: AbortSignal,
  ) => {
    const saved = await saveMutation.mutateAsync({ payload, file, signal });
    showToast(
      mode === "create" ? "Đã thêm sản phẩm mới." : "Đã cập nhật sản phẩm.",
    );
    navigate(`/admin/products/${saved.id}${location.search}`, {
      replace: true,
    });
  };

  if (loading)
    return (
      <section className="state-panel">
        <LoaderCircle className="spin" size={26} aria-hidden="true" />
        <h2>Đang tải biểu mẫu</h2>
        <p>Vui lòng chờ trong giây lát.</p>
      </section>
    );
  if (notFound)
    return (
      <section className="state-panel">
        <h2>Không tìm thấy sản phẩm</h2>
        <p>Sản phẩm có thể đã bị xóa hoặc đường dẫn không hợp lệ.</p>
        <button type="button" className="primary-button" onClick={backToList}>
          Về danh sách
        </button>
      </section>
    );
  if (loadFailed || (mode === "edit" && !product))
    return (
      <section className="state-panel">
        <h2>Không thể tải dữ liệu sản phẩm</h2>
        <p>Kiểm tra kết nối rồi thử lại.</p>
        <button type="button" className="primary-button" onClick={retryLoad}>
          Thử lại
        </button>
        <button type="button" className="secondary-button" onClick={backToList}>
          Về danh sách
        </button>
      </section>
    );

  const title = mode === "create" ? "Thêm sản phẩm" : "Chỉnh sửa sản phẩm";
  return (
    <>
      <header className="page-header">
        <div className="breadcrumb">
          <Link to={`/admin/products${location.search}`}>Sản phẩm</Link>
          <ChevronRight size={14} aria-hidden="true" />
          <strong>{title}</strong>
        </div>
        <div className="page-heading-row">
          <div>
            <h1>{title}</h1>
            <p>
              {mode === "create"
                ? "Điền thông tin để thêm sản phẩm vào danh mục."
                : "Cập nhật thông tin sản phẩm và lưu thay đổi."}
            </p>
          </div>
          <button type="button" className="back-button" onClick={backToList}>
            <ArrowLeft size={16} aria-hidden="true" /> Quay lại
          </button>
        </div>
      </header>
      <ProductForm
        categories={categoriesQuery.categories}
        initialProduct={product}
        onCancel={backToList}
        onSubmit={saveProduct}
        submitLabel={mode === "create" ? "Thêm sản phẩm" : "Lưu thay đổi"}
      />
    </>
  );
}
