import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Leaf, PackageSearch, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { getCategories } from "../api/categories";
import { apiAssetUrl } from "../api/client";
import { StoreProductCard } from "../components/storefront/StoreProductCard";
import { useProducts } from "../hooks/useProducts";
import type { Category } from "../types/catalog";

const featuredQuery = { page: 1, page_size: 3, sort_by: "created_at" as const, order: "desc" as const };

export function StorefrontHomePage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const query = useMemo(() => featuredQuery, []);
  const { data, error, loading, retry } = useProducts(query);
  const products = data?.items ?? [];
  const heroProduct = products[0];
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  useEffect(() => {
    const controller = new AbortController();
    void getCategories(controller.signal).then((response) => setCategories(response.data)).catch(() => setCategories([]));
    return () => controller.abort();
  }, []);

  return <>
    <section className="store-hero"><div className="storefront-container store-hero-grid"><div className="store-hero-copy"><p className="store-kicker"><Leaf size={15} aria-hidden="true" /> Chọn lựa gọn gàng</p><h1>Sản phẩm tốt cho nhịp sống mỗi ngày.</h1><p>Khám phá catalog được cập nhật trực tiếp từ hệ thống của bạn.</p><div className="store-hero-actions"><Link className="store-primary" to="/shop">Khám phá sản phẩm <ArrowRight size={17} aria-hidden="true" /></Link><a className="store-secondary" href="#featured">Sản phẩm mới</a></div></div><div className="store-hero-visual">{heroProduct?.image_url ? <img src={apiAssetUrl(heroProduct.image_url)} alt={heroProduct.name} /> : <div className="store-hero-fallback"><PackageSearch size={42} aria-hidden="true" /><span>Catalog của bạn, sẵn sàng để khám phá.</span></div>}</div></div></section>
    <section className="store-benefits"><div className="storefront-container"><div><ShieldCheck size={20} aria-hidden="true" /><span>Dữ liệu sản phẩm cập nhật từ API</span></div><div><Leaf size={20} aria-hidden="true" /><span>Ảnh WebP tối ưu cho trải nghiệm duyệt nhanh</span></div><div><PackageSearch size={20} aria-hidden="true" /><span>Tìm kiếm theo nhu cầu của bạn</span></div></div></section>
    <section className="store-section storefront-container"><h2>Chọn theo danh mục</h2><p className="store-section-intro">Bắt đầu từ nhóm sản phẩm phù hợp nhất với bạn.</p><div className="store-category-grid">{categories.slice(0, 6).map((category) => <Link key={category.id} to={`/shop?category_id=${category.id}`}><span>{category.name}</span><ArrowRight size={17} aria-hidden="true" /></Link>)}</div></section>
    <section id="featured" className="store-section storefront-container"><div className="store-section-heading"><div><h2>Sản phẩm mới trong catalog</h2><p className="store-section-intro">Duyệt sản phẩm thật và xem chi tiết trước khi lựa chọn.</p></div><Link to="/shop">Xem tất cả <ArrowRight size={17} aria-hidden="true" /></Link></div>{error ? <div className="store-state"><p>Không thể tải sản phẩm lúc này.</p><button type="button" onClick={retry}>Thử lại</button></div> : <div className="store-product-grid" aria-busy={loading}>{loading ? <StorefrontSkeleton /> : products.map((product) => <StoreProductCard key={product.id} product={product} categoryName={categoryNames.get(product.category_id)} />)}</div>}</section>
  </>;
}

function StorefrontSkeleton() {
  return <><div className="store-skeleton" /><div className="store-skeleton" /><div className="store-skeleton" /></>;
}
