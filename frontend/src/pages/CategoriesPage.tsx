import { useCallback, useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { ChevronRight, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { deleteCategory, getCategories } from "../api/categories";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { useToast } from "../components/feedback/Toast";
import type { Category } from "../types/catalog";
import { formatDate } from "../utils/format";

export function CategoriesPage() {
  const { showToast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [target, setTarget] = useState<Category>();
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void getCategories(controller.signal)
      .then((response) => setCategories(response.data))
      .catch((requestError: unknown) => {
        if (!(isAxiosError(requestError) && requestError.code === "ERR_CANCELED"))
          setError(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => load(), [load]);

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return query
      ? categories.filter((category) => category.name.toLocaleLowerCase("vi").includes(query))
      : categories;
  }, [categories, search]);

  const remove = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await deleteCategory(target.id);
      setCategories((current) => current.filter((category) => category.id !== target.id));
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
    } finally {
      setDeleting(false);
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
          <button type="button" className="primary-button" onClick={load}>Thử lại</button>
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
          busy={deleting}
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
