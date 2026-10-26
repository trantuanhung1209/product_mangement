import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { ChevronRight, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { useToast } from "../components/feedback/Toast";
import { useCategories } from "../hooks/useCategories";
import { useDeleteCategory } from "../hooks/useCategoryMutations";
import type { Category } from "../types/catalog";
import { formatDate } from "../utils/format";

export function CategoriesPage() {
  const { showToast } = useToast();
  const { categories, loading, error, retry } = useCategories();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<Category>();
  const deleteMutation = useDeleteCategory();

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return query
      ? categories.filter((category) => category.name.toLocaleLowerCase("vi").includes(query))
      : categories;
  }, [categories, search]);

  const remove = async () => {
    if (!target) return;
    try {
      await deleteMutation.mutateAsync(target.id);
      setTarget(undefined);
      showToast("Đã xóa danh mục.");
    } catch (requestError) {
      const isInUse = isAxiosError(requestError) && requestError.response?.status === 409;
      showToast(
        isInUse
          ? "Không thể xóa danh mục đang có sản phẩm sử dụng."
          : "Không thể xóa danh mục. Vui lòng thử lại.",
        "error",
      );
      setTarget(undefined);
    }
  };

  return (
    <>
      <header className="page-header">
        <div className="breadcrumb">
          <span>Quản trị</span>
          <ChevronRight size={14} aria-hidden="true" />
          <strong>Danh mục</strong>
        </div>
        <div className="page-heading-row">
          <div>
            <h1>Danh mục</h1>
            <p>Tổ chức các nhóm sản phẩm trong catalog.</p>
          </div>
          <Link className="primary-button button-link" to="/admin/categories/new">
            <Plus size={16} aria-hidden="true" /> Thêm danh mục
          </Link>
        </div>
      </header>

      <label className="search-field category-search">
        <Search size={16} aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm theo tên danh mục"
          aria-label="Tìm theo tên danh mục"
        />
      </label>

      {loading ? (
        <section className="state-panel">
          <p>Đang tải danh mục...</p>
        </section>
      ) : error ? (
        <section className="state-panel">
          <h2>Không thể tải danh mục</h2>
          <p>Kiểm tra kết nối rồi thử lại.</p>
          <button type="button" className="primary-button" onClick={retry}>Thử lại</button>
        </section>
      ) : !filteredCategories.length ? (
        <section className="state-panel">
          <Tags size={28} aria-hidden="true" />
          <h2>{search ? "Không tìm thấy danh mục" : "Chưa có danh mục nào"}</h2>
          <p>{search ? "Hãy thử một từ khóa khác." : "Tạo danh mục đầu tiên để phân loại sản phẩm."}</p>
        </section>
      ) : (
        <div className="table-wrap">
          <table className="product-table">
            <thead>
              <tr><th>ID</th><th>Tên danh mục</th><th>Mô tả</th><th>Ngày tạo</th><th aria-label="Thao tác" /></tr>
            </thead>
            <tbody>
              {filteredCategories.map((category) => (
                <tr key={category.id}>
                  <td data-label="ID" className="muted-cell">#{category.id}</td>
                  <td data-label="Tên danh mục"><strong>{category.name}</strong></td>
                  <td data-label="Mô tả" className="category-description">{category.description || "—"}</td>
                  <td data-label="Ngày tạo" className="muted-cell">{formatDate(category.created_at)}</td>
                  <td data-label="Thao tác"><div className="table-actions">
                    <Link to={`/admin/categories/${category.id}/edit`} aria-label={`Sửa ${category.name}`}><Pencil size={16} aria-hidden="true" /></Link>
                    <button type="button" onClick={() => setTarget(category)} aria-label={`Xóa ${category.name}`}><Trash2 size={16} aria-hidden="true" /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {target && (
        <ConfirmDialog
          busy={deleteMutation.isPending}
          confirmLabel="Xóa danh mục"
          title="Xóa danh mục này?"
          description={`“${target.name}” sẽ bị xóa nếu chưa có sản phẩm sử dụng.`}
          onCancel={() => setTarget(undefined)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}
