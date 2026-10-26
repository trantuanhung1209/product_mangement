import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import shopIntroImage from "../assets/store-hero-02.webp";
import { ProductFilters } from "../components/products/ProductFilters";
import { StoreProductCard } from "../components/storefront/StoreProductCard";
import { useCategories } from "../hooks/useCategories";
import { useDebounce } from "../hooks/useDebounce";
import { useProducts } from "../hooks/useProducts";
import { useProductsCursor } from "../hooks/useProductsCursor";
import type {
  ProductCursorFilters,
  ProductQuery,
  SortBy,
  SortOrder,
} from "../types/catalog";

const sortByValues: SortBy[] = ["id", "name", "price", "stock", "created_at"];
const orderValues: SortOrder[] = ["asc", "desc"];

function parsePrice(value: string | null) {
  return value !== null &&
    value.trim() !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
    ? value
    : undefined;
}

function queryFromParams(params: URLSearchParams): ProductQuery {
  const categoryId = Number(params.get("category_id"));
  const sortBy = params.get("sort_by");
  const order = params.get("order");
  const minPrice = parsePrice(params.get("min_price"));
  const maxPrice = parsePrice(params.get("max_price"));
  const priceRangeIsValid =
    !minPrice || !maxPrice || Number(minPrice) <= Number(maxPrice);
  return {
    page: Math.max(1, Number(params.get("page")) || 1),
    page_size: 8,
    search: params.get("search")?.trim() || undefined,
    category_id:
      Number.isInteger(categoryId) && categoryId > 0 ? categoryId : undefined,
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

export function StorefrontShopPage() {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => queryFromParams(params), [params]);
  const [search, setSearch] = useState(query.search ?? "");
  const debouncedSearch = useDebounce(search);
  const searchWasCleared = useRef(false);
  const { categories } = useCategories();
  // Newest-first (the default) is what the cursor API serves, so it gets "load more". Any other
  // sort needs the offset API, which keeps its page numbers and totals.
  const cursorMode = query.sort_by === "created_at" && query.order === "desc";
  const cursorFilters = useMemo<ProductCursorFilters>(
    () => ({
      limit: query.page_size,
      search: query.search,
      category_id: query.category_id,
      min_price: query.min_price,
      max_price: query.max_price,
    }),
    [query.page_size, query.search, query.category_id, query.min_price, query.max_price],
  );
  const offsetList = useProducts(query, { enabled: !cursorMode });
  const cursorList = useProductsCursor(cursorFilters, { enabled: cursorMode });
  const data = offsetList.data;
  const items = cursorMode ? cursorList.items : (data?.items ?? []);
  const { error, loading, retry } = cursorMode ? cursorList : offsetList;
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name]),
  );

  const update = useCallback(
    (changes: Record<string, string | undefined>) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        Object.entries(changes).forEach(([key, value]) =>
          value ? next.set(key, value) : next.delete(key),
        );
        if (!("page" in changes)) next.set("page", "1");
        return next;
      });
    },
    [setParams],
  );

  useEffect(() => setSearch(query.search ?? ""), [query.search]);
  useEffect(() => {
    if (searchWasCleared.current && debouncedSearch !== "") return;
    if (debouncedSearch === "") searchWasCleared.current = false;
    if (debouncedSearch.trim() !== (query.search ?? ""))
      update({ search: debouncedSearch.trim() || undefined });
  }, [debouncedSearch, query.search, update]);
  const handleFiltersChange = (changes: Record<string, string | undefined>) => {
    if ("search" in changes && changes.search === undefined) {
      searchWasCleared.current = true;
      setSearch("");
    }
    update(changes);
  };

  return (
    <section className="storefront-container store-shop">
      <nav className="store-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Trang chủ</Link>
        <span>/</span>
        <strong>Sản phẩm</strong>
      </nav>
      <header className="store-shop-intro">
        <div>
          <p className="store-kicker">
            <SlidersHorizontal size={15} aria-hidden="true" /> Catalog công khai
          </p>
          <h1>Tìm sản phẩm phù hợp</h1>
          <p>Lọc theo danh mục, mức giá hoặc cách sắp xếp bạn muốn.</p>
        </div>
        <img src={shopIntroImage} alt="" />
      </header>
      <ProductFilters
        categories={categories}
        categoryId={query.category_id}
        minPrice={query.min_price}
        maxPrice={query.max_price}
        search={search}
        sortBy={query.sort_by}
        order={query.order}
        onSearchChange={setSearch}
        onChange={handleFiltersChange}
      />
      {error ? (
        <div className="store-state">
          <p>Không thể tải catalog. Kiểm tra kết nối rồi thử lại.</p>
          <button type="button" onClick={retry}>
            Thử lại
          </button>
        </div>
      ) : (
        <>
          <div className="store-results-meta">
            <p>
              {loading
                ? "Đang tải sản phẩm"
                : cursorMode
                  ? `Đang hiển thị ${items.length} sản phẩm`
                  : `${data?.total ?? 0} sản phẩm`}
            </p>
          </div>
          {!loading && !items.length ? (
            <div className="store-state">
              <h2>Chưa tìm thấy sản phẩm</h2>
              <p>Hãy thử điều chỉnh bộ lọc hoặc từ khóa tìm kiếm.</p>
              <button type="button" onClick={() => setParams({})}>
                Xem toàn bộ catalog
              </button>
            </div>
          ) : (
            <div className="store-product-grid" aria-busy={loading}>
              {loading ? (
                <StorefrontSkeleton />
              ) : (
                items.map((product) => (
                  <StoreProductCard
                    key={product.id}
                    product={product}
                    categoryName={categoryNames.get(product.category_id)}
                  />
                ))
              )}
            </div>
          )}
          {cursorMode && !loading && items.length > 0 && (
            <nav className="store-pagination" aria-label="Tải thêm sản phẩm">
              {cursorList.loadMoreError && (
                <span role="alert">Không thể tải thêm sản phẩm.</span>
              )}
              {cursorList.hasMore ? (
                <button type="button" disabled={cursorList.loadingMore} onClick={cursorList.loadMore}>
                  {cursorList.loadingMore ? "Đang tải..." : cursorList.loadMoreError ? "Thử lại" : "Tải thêm sản phẩm"}
                </button>
              ) : (
                <span>Đã hiển thị tất cả sản phẩm</span>
              )}
            </nav>
          )}
          {!cursorMode && data && data.total_pages > 1 && (
            <nav className="store-pagination" aria-label="Phân trang">
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => update({ page: String(data.page - 1) })}
              >
                Trang trước
              </button>
              <span>
                Trang {data.page} / {data.total_pages}
              </span>
              <button
                type="button"
                disabled={data.page >= data.total_pages}
                onClick={() => update({ page: String(data.page + 1) })}
              >
                Trang sau
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function StorefrontSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="store-skeleton" />
      ))}
    </>
  );
}
