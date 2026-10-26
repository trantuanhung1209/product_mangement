import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { useToast } from "../components/feedback/Toast";
import { useAuth } from "../auth/AuthContext";
import { Pagination } from "../components/products/Pagination";
import { ProductFilters } from "../components/products/ProductFilters";
import { ProductTable } from "../components/products/ProductTable";
import { useCategories } from "../hooks/useCategories";
import { useDebounce } from "../hooks/useDebounce";
import { useDeleteProduct } from "../hooks/useProductMutations";
import { useProducts } from "../hooks/useProducts";
import type {
  Product,
  ProductQuery,
  SortBy,
  SortOrder,
} from "../types/catalog";

const sortByValues: SortBy[] = ["id", "name", "price", "stock", "created_at"];
const orderValues: SortOrder[] = ["asc", "desc"];
const pageSizes = [10, 20, 50, 100];

function parsePositive(
  value: string | null,
  fallback: number,
  allowed?: number[],
) {
  const number = Number(value);
  return Number.isInteger(number) &&
    number > 0 &&
    (!allowed || allowed.includes(number))
    ? number
    : fallback;
}

function parsePrice(value: string | null) {
  return value !== null &&
    value.trim() !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
    ? value
    : undefined;
}

function parseQuery(searchParams: URLSearchParams): ProductQuery {
  const sortBy = searchParams.get("sort_by");
  const order = searchParams.get("order");
  const minPrice = parsePrice(searchParams.get("min_price"));
  const maxPrice = parsePrice(searchParams.get("max_price"));
  const priceRangeIsValid =
    !minPrice || !maxPrice || Number(minPrice) <= Number(maxPrice);
  return {
    page: parsePositive(searchParams.get("page"), 1),
    page_size: parsePositive(searchParams.get("page_size"), 10, pageSizes),
    search: searchParams.get("search")?.trim() || undefined,
    category_id: parsePositive(searchParams.get("category_id"), 0) || undefined,
    min_price: priceRangeIsValid ? minPrice : undefined,
    max_price: priceRangeIsValid ? maxPrice : undefined,
    sort_by: sortByValues.includes(sortBy as SortBy)
      ? (sortBy as SortBy)
      : "created_at",
    order: orderValues.includes(order as SortOrder)
      ? (order as SortOrder)
      : "desc",
  };
}

export function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { showToast } = useToast();
  const { user } = useAuth();
  const query = useMemo(() => parseQuery(searchParams), [searchParams]);
  const [searchInput, setSearchInput] = useState(query.search ?? "");
  const debouncedSearch = useDebounce(searchInput);
  const searchWasCleared = useRef(false);
  const { categories } = useCategories();
  const [productToDelete, setProductToDelete] = useState<Product>();
  const deleteMutation = useDeleteProduct();
  const { data, error, loading, retry } = useProducts(query);

  const updateParams = useCallback(
    (changes: Record<string, string | undefined>, resetPage = true) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        Object.entries(changes).forEach(([key, value]) =>
          value ? next.set(key, value) : next.delete(key),
        );
        if (resetPage && !("page" in changes)) next.set("page", "1");
        return next;
      });
    },
    [setSearchParams],
  );

  useEffect(() => setSearchInput(query.search ?? ""), [query.search]);

  useEffect(() => {
    if (searchWasCleared.current && debouncedSearch !== "") return;
    if (debouncedSearch === "") searchWasCleared.current = false;
    if (debouncedSearch.trim() !== (query.search ?? ""))
      updateParams({ search: debouncedSearch.trim() || undefined });
  }, [debouncedSearch, query.search, updateParams]);

  const handleChange = useCallback(
    (changes: Record<string, string | undefined>, resetPage = true) => {
      if ("search" in changes && changes.search === undefined) {
        searchWasCleared.current = true;
        setSearchInput("");
      }
      updateParams(changes, resetPage);
    },
    [updateParams],
  );
  const hasFilters = Boolean(
    query.search ||
    query.category_id ||
    query.min_price ||
    query.max_price ||
    query.sort_by !== "created_at" ||
    query.order !== "desc",
  );
  const handleDelete = async () => {
    if (!productToDelete) return;
    try {
      await deleteMutation.mutateAsync(productToDelete.id);
      showToast("Đã xóa sản phẩm.");
    } catch {
      showToast("Không thể xóa sản phẩm. Vui lòng thử lại.", "error");
    }
    setProductToDelete(undefined);
  };

  return (
    <>
      <header className="page-header">
        <div className="breadcrumb">
          <span>Danh mục</span>
          <ChevronRight size={14} aria-hidden="true" />
          <strong>Sản phẩm</strong>
        </div>
        <div className="page-heading-row">
          <div>
            <h1>Sản phẩm</h1>
            <p>Quản lý và tìm kiếm danh mục sản phẩm của bạn.</p>
          </div>
          {user?.role === "ADMIN" && (
            <Link
              className="primary-button button-link"
              to={`/admin/products/new${location.search}`}
            >
              <Plus size={16} aria-hidden="true" /> Thêm sản phẩm
            </Link>
          )}
        </div>
      </header>
      <ProductFilters
        categories={categories}
        categoryId={query.category_id}
        minPrice={query.min_price}
        maxPrice={query.max_price}
        search={searchInput}
        sortBy={query.sort_by}
        order={query.order}
        onSearchChange={setSearchInput}
        onChange={handleChange}
      />
      <ProductTable
        categories={categories}
        products={data?.items ?? []}
        loading={loading}
        error={error}
        hasFilters={hasFilters}
        onRetry={retry}
        onRequestDelete={setProductToDelete}
        search={location.search}
        canManage={user?.role === "ADMIN"}
      />
      {!error && !loading && data && (
        <Pagination
          page={data.page}
          pageSize={data.page_size}
          total={data.total}
          totalPages={data.total_pages}
          onChange={handleChange}
        />
      )}
      {productToDelete && (
        <ConfirmDialog
          busy={deleteMutation.isPending}
          title="Xóa sản phẩm này?"
          description={`“${productToDelete.name}” sẽ bị xóa vĩnh viễn và không thể khôi phục.`}
          onCancel={() => setProductToDelete(undefined)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  );
}
