import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { ArrowLeft, ArrowRight, ImageOff, PackageCheck, ShoppingCart } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { getCategories } from "../api/categories";
import { apiAssetUrl } from "../api/client";
import { getProduct } from "../api/products";
import { useAuth } from "../auth/AuthContext";
import { useCart } from "../cart/CartContext";
import { QuantityControl } from "../components/storefront/QuantityControl";
import { useToast } from "../components/feedback/Toast";
import type { Category, Product } from "../types/catalog";
import { formatPrice } from "../utils/format";

export function StorefrontProductPage() {
  const { productId } = useParams();
  const [product, setProduct] = useState<Product>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const { user } = useAuth();
  const { addItem } = useCart();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const productIdNumber = Number(productId);

  useEffect(() => {
    if (!Number.isInteger(productIdNumber) || productIdNumber <= 0) {
      setError(true);
      return;
    }
    const controller = new AbortController();
    let isCurrent = true;
    setError(false);
    void Promise.all([
      getProduct(productIdNumber, controller.signal),
      getCategories(controller.signal),
    ])
      .then(([productResponse, categoriesResponse]) => {
        if (!isCurrent) return;
        setProduct(productResponse.data);
        setCategories(categoriesResponse.data);
        setQuantity(1);
      })
      .catch((requestError: unknown) => {
        if (
          isCurrent &&
          !(isAxiosError(requestError) && requestError.code === "ERR_CANCELED")
        )
          setError(true);
      });
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [productIdNumber]);

  if (error)
    return (
      <section className="storefront-container store-state">
        <h1>Không tìm thấy sản phẩm</h1>
        <p>Sản phẩm có thể đã được gỡ khỏi catalog.</p>
        <Link to="/shop">Về catalog</Link>
      </section>
    );
  if (!product)
    return (
      <section className="storefront-container store-state" aria-busy="true">
        <p>Đang tải sản phẩm.</p>
      </section>
    );
  const categoryName =
    categories.find((category) => category.id === product.category_id)?.name ??
    "Danh mục sản phẩm";
  const addToCart = async () => {
    if (!user) {
      navigate("/login", { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    setAdding(true);
    try {
      await addItem(product.id, quantity);
      showToast(`Đã thêm ${quantity} ${product.name} vào giỏ hàng.`);
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : "Không thể thêm vào giỏ hàng.", "error");
    } finally {
      setAdding(false);
    }
  };
  return (
    <section className="storefront-container store-product-detail">
      <nav className="store-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Trang chủ</Link>
        <span>/</span>
        <Link to="/shop">Sản phẩm</Link>
        <span>/</span>
        <strong>{product.name}</strong>
      </nav>
      <Link className="store-back" to="/shop">
        <ArrowLeft size={17} aria-hidden="true" /> Về catalog
      </Link>
      <div className="store-detail-grid">
        <div className="store-detail-image">
          {product.image_url ? (
            <img src={apiAssetUrl(product.image_url)} alt={product.name} />
          ) : (
            <span>
              <ImageOff size={34} aria-hidden="true" /> Chưa có hình ảnh
            </span>
          )}
        </div>
        <div className="store-detail-copy">
          <p>{categoryName}</p>
          <h1>{product.name}</h1>
          <strong>{formatPrice(product.price)}</strong>
          <span
            className={
              product.stock > 0
                ? "store-stock"
                : "store-stock store-stock-empty"
            }
          >
            <PackageCheck size={15} aria-hidden="true" />
            {product.stock > 0
              ? `Còn ${product.stock} sản phẩm`
              : "Tạm hết hàng"}
          </span>
          <div>
            <h2>Thông tin sản phẩm</h2>
            <p>
              {product.description ||
                "Thông tin chi tiết sẽ được cập nhật trong catalog."}
            </p>
          </div>
          <div className="store-detail-cart">
            <QuantityControl value={quantity} max={Math.max(1, product.stock)} disabled={adding || product.stock <= 0} onChange={setQuantity} />
            <button className="store-primary" type="button" onClick={addToCart} disabled={adding || product.stock <= 0}>
              <ShoppingCart size={17} aria-hidden="true" />
              {adding ? "Đang thêm..." : "Thêm vào giỏ"}
            </button>
          </div>
          <Link className="store-secondary" to="/shop">
            Tiếp tục khám phá <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
