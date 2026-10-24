import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { getCategories } from "../api/categories";
import { StoreProductCard } from "../components/storefront/StoreProductCard";
import { useProducts } from "../hooks/useProducts";
import type { Category, ProductQuery } from "../types/catalog";

function queryFromParams(params: URLSearchParams): ProductQuery {
  const categoryId = Number(params.get("category_id"));
  return { page: Math.max(1, Number(params.get("page")) || 1), page_size: 12, search: params.get("search")?.trim() || undefined, category_id: Number.isInteger(categoryId) && categoryId > 0 ? categoryId : undefined, sort_by: "created_at", order: "desc" };
}

export function StorefrontShopPage() {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => queryFromParams(params), [params]);
  const [search, setSearch] = useState(query.search ?? "");
  const [categories, setCategories] = useState<Category[]>([]);
  const { data, error, loading, retry } = useProducts(query);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  useEffect(() => setSearch(query.search ?? ""), [query.search]);
  useEffect(() => { const controller = new AbortController(); void getCategories(controller.signal).then((response) => setCategories(response.data)).catch(() => setCategories([])); return () => controller.abort(); }, []);
  const update = (changes: Record<string, string | undefined>) => setParams((current) => { const next = new URLSearchParams(current); Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); if (!("page" in changes)) next.set("page", "1"); return next; });
  const submit = (event: FormEvent) => { event.preventDefault(); update({ search: search.trim() || undefined }); };

  return <section className="storefront-container store-shop"><nav className="store-breadcrumb" aria-label="Breadcrumb"><Link to="/">Trang chủ</Link><span>/</span><strong>Sản phẩm</strong></nav><header><p className="store-kicker"><SlidersHorizontal size={15} aria-hidden="true" /> Catalog công khai</p><h1>Duyệt sản phẩm</h1><p>Tìm kiếm theo tên hoặc chọn một danh mục để thu hẹp kết quả.</p></header><form className="store-search" onSubmit={submit}><Search size={19} aria-hidden="true" /><label className="sr-only" htmlFor="store-search-input">Tìm kiếm sản phẩm</label><input id="store-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm sản phẩm" /><button type="submit">Tìm kiếm</button></form><div className="store-category-rail" aria-label="Danh mục sản phẩm"><button type="button" className={!query.category_id ? "active" : ""} onClick={() => update({ category_id: undefined })}>Tất cả</button>{categories.map((category) => <button key={category.id} type="button" className={query.category_id === category.id ? "active" : ""} onClick={() => update({ category_id: String(category.id)})}>{category.name}</button>)}</div>{error ? <div className="store-state"><p>Không thể tải catalog. Kiểm tra kết nối rồi thử lại.</p><button type="button" onClick={retry}>Thử lại</button></div> : <><div className="store-results-meta"><p>{loading ? "Đang tải sản phẩm" : `${data?.total ?? 0} sản phẩm`}</p>{query.search && <button type="button" onClick={() => update({ search: undefined })}>Xóa tìm kiếm</button>}</div>{!loading && !data?.items.length ? <div className="store-state"><h2>Chưa tìm thấy sản phẩm</h2><p>Hãy thử từ khóa hoặc danh mục khác.</p><button type="button" onClick={() => setParams({})}>Xem toàn bộ catalog</button></div> : <div className="store-product-grid" aria-busy={loading}>{loading ? <><div className="store-skeleton" /><div className="store-skeleton" /><div className="store-skeleton" /></> : data?.items.map((product) => <StoreProductCard key={product.id} product={product} categoryName={categoryNames.get(product.category_id)} />)}</div>}{data && data.total_pages > 1 && <nav className="store-pagination" aria-label="Phân trang"><button type="button" disabled={data.page <= 1} onClick={() => update({ page: String(data.page - 1) })}>Trang trước</button><span>Trang {data.page} / {data.total_pages}</span><button type="button" disabled={data.page >= data.total_pages} onClick={() => update({ page: String(data.page + 1) })}>Trang sau</button></nav>}</>}</section>;
}
