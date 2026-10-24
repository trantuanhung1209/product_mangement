import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Leaf, PackageSearch, Pause, Play, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { getCategories } from "../api/categories";
import heroImageOne from "../assets/store-hero-01.webp";
import heroImageTwo from "../assets/store-hero-02.webp";
import heroImageThree from "../assets/store-hero-03.webp";
import { StoreProductCard } from "../components/storefront/StoreProductCard";
import { useProducts } from "../hooks/useProducts";
import type { Category } from "../types/catalog";

const featuredQuery = { page: 1, page_size: 3, sort_by: "created_at" as const, order: "desc" as const };
const heroSlides = [
  { image: heroImageOne, title: "Chọn sản phẩm theo cách của bạn.", description: "Duyệt catalog, xem thông tin thật và tìm lựa chọn phù hợp cho mỗi ngày." },
  { image: heroImageTwo, title: "Những món thiết thực, được chọn gọn gàng.", description: "Từ đồ dùng cá nhân đến sản phẩm cho góc làm việc, tất cả ở cùng một nơi." },
  { image: heroImageThree, title: "Khám phá một nhịp sống xanh hơn.", description: "Tìm kiếm nhanh theo danh mục và xem sản phẩm mới trong catalog của bạn." },
];

export function StorefrontHomePage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const query = useMemo(() => featuredQuery, []);
  const { data, error, loading, retry } = useProducts(query);
  const products = data?.items ?? [];
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  useEffect(() => {
    const controller = new AbortController();
    void getCategories(controller.signal).then((response) => setCategories(response.data)).catch(() => setCategories([]));
    return () => controller.abort();
  }, []);

  return <>
    <HeroCarousel />
    <section className="store-benefits"><div className="storefront-container"><div><ShieldCheck size={20} aria-hidden="true" /><span>Dữ liệu sản phẩm cập nhật từ API</span></div><div><Leaf size={20} aria-hidden="true" /><span>Ảnh WebP tối ưu cho trải nghiệm duyệt nhanh</span></div><div><PackageSearch size={20} aria-hidden="true" /><span>Tìm kiếm theo nhu cầu của bạn</span></div></div></section>
    <section className="store-section storefront-container"><h2>Chọn theo danh mục</h2><p className="store-section-intro">Bắt đầu từ nhóm sản phẩm phù hợp nhất với bạn.</p><div className="store-category-grid">{categories.slice(0, 6).map((category) => <Link key={category.id} to={`/shop?category_id=${category.id}`}><span>{category.name}</span><ArrowRight size={17} aria-hidden="true" /></Link>)}</div></section>
    <section id="featured" className="store-section storefront-container"><div className="store-section-heading"><div><h2>Sản phẩm mới trong catalog</h2><p className="store-section-intro">Duyệt sản phẩm thật và xem chi tiết trước khi lựa chọn.</p></div><Link to="/shop">Xem tất cả <ArrowRight size={17} aria-hidden="true" /></Link></div>{error ? <div className="store-state"><p>Không thể tải sản phẩm lúc này.</p><button type="button" onClick={retry}>Thử lại</button></div> : <div className="store-product-grid" aria-busy={loading}>{loading ? <StorefrontSkeleton /> : products.map((product) => <StoreProductCard key={product.id} product={product} categoryName={categoryNames.get(product.category_id)} />)}</div>}</section>
  </>;
}

function HeroCarousel() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReduceMotion(media.matches);
    updateMotionPreference();
    media.addEventListener("change", updateMotionPreference);
    return () => media.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    if (isPaused || isHovering || reduceMotion) return;
    const timer = window.setTimeout(() => setActiveSlide((current) => (current + 1) % heroSlides.length), 6500);
    return () => window.clearTimeout(timer);
  }, [activeSlide, isHovering, isPaused, reduceMotion]);

  const slide = heroSlides[activeSlide];
  const previous = () => setActiveSlide((current) => (current + heroSlides.length - 1) % heroSlides.length);
  const next = () => setActiveSlide((current) => (current + 1) % heroSlides.length);

  return <section className="store-hero" aria-roledescription="carousel" aria-label="Sản phẩm nổi bật" onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)}>
    <div className="store-hero-slides" aria-hidden="true">{heroSlides.map((item, index) => <img key={item.image} className={index === activeSlide ? "active" : ""} src={item.image} alt="" fetchPriority={index === 0 ? "high" : "auto"} loading={index === 0 ? "eager" : "lazy"} />)}</div>
    <div className="store-hero-shade" />
    <div className="storefront-container store-hero-content"><div className="store-hero-copy"><p className="store-kicker"><Leaf size={15} aria-hidden="true" /> Product Catalog</p><h1>{slide.title}</h1><p>{slide.description}</p><div className="store-hero-actions"><Link className="store-primary" to="/shop">Khám phá sản phẩm <ArrowRight size={17} aria-hidden="true" /></Link><a className="store-secondary" href="#featured">Sản phẩm mới</a></div></div><div className="store-hero-controls"><button type="button" onClick={previous} aria-label="Ảnh trước"><ChevronLeft size={19} aria-hidden="true" /></button><div className="store-hero-dots" role="tablist" aria-label="Chọn ảnh hero">{heroSlides.map((item, index) => <button key={item.image} type="button" role="tab" aria-label={`Hiển thị ảnh ${index + 1}`} aria-selected={index === activeSlide} className={index === activeSlide ? "active" : ""} onClick={() => setActiveSlide(index)} />)}</div><button type="button" onClick={() => setIsPaused((current) => !current)} aria-label={isPaused ? "Tiếp tục tự chuyển ảnh" : "Tạm dừng tự chuyển ảnh"}>{isPaused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}</button><button type="button" onClick={next} aria-label="Ảnh tiếp theo"><ChevronRight size={19} aria-hidden="true" /></button></div></div>
  </section>;
}

function StorefrontSkeleton() {
  return <><div className="store-skeleton" /><div className="store-skeleton" /><div className="store-skeleton" /></>;
}
