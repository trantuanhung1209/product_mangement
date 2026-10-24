import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { ArrowLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { createCategory, getCategories, updateCategory } from "../api/categories";
import { getApiFieldErrors } from "../api/errors";
import { CategoryForm } from "../components/categories/CategoryForm";
import { useToast } from "../components/feedback/Toast";
import type { Category, CategoryPayload } from "../types/catalog";

interface CategoryFormPageProps {
  mode: "create" | "edit";
}

function categoryError(error: unknown): string {
  if (isAxiosError(error)) {
    if (error.response?.status === 409) return "Tên danh mục đã tồn tại.";
    if (error.response?.status === 404) return "Danh mục không tồn tại.";
    const fieldErrors = getApiFieldErrors(error);
    if (fieldErrors.name) return "Tên danh mục không hợp lệ.";
  }
  return "Không thể lưu danh mục. Vui lòng thử lại.";
}

export function CategoryFormPage({ mode }: CategoryFormPageProps) {
  const { categoryId } = useParams();
  const categoryIdNumber = Number(categoryId);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [category, setCategory] = useState<Category>();
  const [loading, setLoading] = useState(mode === "edit");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (mode !== "edit") return;
    if (!Number.isInteger(categoryIdNumber) || categoryIdNumber <= 0) {
      setError(true);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void getCategories(controller.signal)
      .then((response) => {
        const currentCategory = response.data.find((item) => item.id === categoryIdNumber);
        if (currentCategory) setCategory(currentCategory);
        else setError(true);
      })
      .catch((requestError: unknown) => {
        if (!(isAxiosError(requestError) && requestError.code === "ERR_CANCELED")) setError(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [categoryIdNumber, mode]);

  const backToList = () => navigate("/admin/categories");
  const submit = async (payload: CategoryPayload) => {
    try {
      if (mode === "create") await createCategory(payload);
      else await updateCategory(categoryIdNumber, payload);
      showToast(mode === "create" ? "Đã thêm danh mục." : "Đã cập nhật danh mục.");
      backToList();
    } catch (requestError) {
      throw new Error(categoryError(requestError));
    }
  };

  if (loading)
    return <section className="state-panel"><LoaderCircle className="spin" size={26} aria-hidden="true" /><h2>Đang tải danh mục</h2><p>Vui lòng chờ trong giây lát.</p></section>;
  if (error || (mode === "edit" && !category))
    return <section className="state-panel"><h2>Không tìm thấy danh mục</h2><p>Danh mục có thể đã bị xóa hoặc đường dẫn không hợp lệ.</p><button type="button" className="primary-button" onClick={backToList}>Về danh sách</button></section>;

  const title = mode === "create" ? "Thêm danh mục" : "Chỉnh sửa danh mục";
  return (
    <>
      <header className="page-header">
        <div className="breadcrumb"><Link to="/admin/categories">Danh mục</Link><ChevronRight size={14} aria-hidden="true" /><strong>{title}</strong></div>
        <div className="page-heading-row">
          <div><h1>{title}</h1><p>{mode === "create" ? "Tạo nhóm mới cho sản phẩm." : "Cập nhật thông tin nhóm sản phẩm."}</p></div>
          <button type="button" className="back-button" onClick={backToList}><ArrowLeft size={16} aria-hidden="true" /> Quay lại</button>
        </div>
      </header>
      <CategoryForm initialCategory={category} onCancel={backToList} onSubmit={submit} submitLabel={mode === "create" ? "Thêm danh mục" : "Lưu thay đổi"} />
    </>
  );
}
