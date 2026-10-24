import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { ArrowLeft, ArrowRight, ImageOff, PackageCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { getCategories } from "../api/categories";
import { apiAssetUrl } from "../api/client";
import { getProduct } from "../api/products";
import type { Category, Product } from "../types/catalog";
import { formatPrice } from "../utils/format";

export function StorefrontProductPage() {
  const { productId } = useParams();
  const [product, setProduct] = useState<Product>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState(false);
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
          <Link className="store-primary" to="/shop">
            Tiếp tục khám phá <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
