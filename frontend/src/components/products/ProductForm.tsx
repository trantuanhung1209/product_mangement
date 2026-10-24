import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";

import { getApiFieldErrors } from "../../api/errors";
import type { Category, Product, ProductPayload } from "../../types/catalog";
import { formatNumber } from "../../utils/format";

type FieldName = keyof ProductPayload;
type FormErrors = Partial<Record<FieldName, string>>;

interface ProductFormProps {
  categories: Category[];
  initialProduct?: Product;
  onCancel: () => void;
  onSubmit: (payload: ProductPayload, signal: AbortSignal) => Promise<void>;
  submitLabel: string;
}

function initialValues(product?: Product): ProductPayload {
  return {
    name: product?.name ?? "",
    description: product?.description ?? null,
    price: product?.price ?? "",
    stock: product?.stock ?? 0,
    category_id: product?.category_id ?? 0,
    image_url: product?.image_url ?? null,
  };
}

function validate(values: ProductPayload): FormErrors {
  const errors: FormErrors = {};
  if (!values.name.trim()) errors.name = "Vui lòng nhập tên sản phẩm.";
  if (!values.price || !Number.isFinite(Number(values.price)) || Number(values.price) <= 0) errors.price = "Giá bán phải lớn hơn 0.";
  if (!Number.isInteger(values.stock) || values.stock < 0) errors.stock = "Tồn kho phải là số nguyên từ 0 trở lên.";
  if (!values.category_id) errors.category_id = "Vui lòng chọn danh mục.";
  if (values.image_url) {
    try {
      const url = new URL(values.image_url);
      if (!/^https?:$/.test(url.protocol)) throw new Error("unsupported protocol");
    } catch {
      errors.image_url = "URL ảnh phải bắt đầu bằng http:// hoặc https://.";
    }
  }
  return errors;
}

const fieldLabels: Record<FieldName, string> = {
  name: "Tên sản phẩm",
  description: "Mô tả",
  price: "Giá bán",
  stock: "Tồn kho",
  category_id: "Danh mục",
  image_url: "URL hình ảnh",
};

export function ProductForm({ categories, initialProduct, onCancel, onSubmit, submitLabel }: ProductFormProps) {
  const [values, setValues] = useState<ProductPayload>(() => initialValues(initialProduct));
  const [priceInput, setPriceInput] = useState(() => values.price ? formatNumber(values.price) : "");
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const updateValue = <K extends FieldName>(field: K, value: ProductPayload[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const validateField = (field: FieldName) => {
    const fieldError = validate(values)[field];
    setErrors((current) => ({ ...current, [field]: fieldError }));
  };

  const updatePrice = (input: string) => {
    const price = input.replace(/\D/g, "");
    updateValue("price", price);
    setPriceInput(price ? formatNumber(price) : "");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: ProductPayload = { ...values, name: values.name.trim(), description: values.description?.trim() || null, image_url: values.image_url?.trim() || null };
    const nextErrors = validate(payload);
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSubmitting(true);
    try {
      await onSubmit(payload, controller.signal);
    } catch (error: unknown) {
      if (isAxiosError(error) && error.code === "ERR_CANCELED") return;
      const apiFieldErrors = getApiFieldErrors(error);
      if (Object.keys(apiFieldErrors).length) {
        setErrors(Object.keys(apiFieldErrors).reduce<FormErrors>((result, field) => {
          if (field in fieldLabels) result[field as FieldName] = `${fieldLabels[field as FieldName]} không hợp lệ.`;
          return result;
        }, {}));
      } else setFormError("Không thể lưu sản phẩm. Vui lòng kiểm tra dữ liệu và thử lại.");
    } finally {
      if (controllerRef.current === controller) setSubmitting(false);
    }
  };

  return <form className="product-form" onSubmit={handleSubmit} noValidate>
    {formError && <p className="form-error" role="alert">{formError}</p>}
    <div className="form-grid">
      <label className="form-field form-field-wide">Tên sản phẩm <span aria-hidden="true">*</span><input value={values.name} onChange={(event) => updateValue("name", event.target.value)} onBlur={() => validateField("name")} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} autoFocus />{errors.name && <small id="name-error" className="field-error" role="alert">{errors.name}</small>}</label>
      <label className="form-field">Giá bán (VNĐ) <span aria-hidden="true">*</span><input type="text" inputMode="numeric" value={priceInput} onChange={(event) => updatePrice(event.target.value)} onBlur={() => validateField("price")} aria-invalid={Boolean(errors.price)} aria-describedby={errors.price ? "price-error" : "price-help"} placeholder="Ví dụ: 899.000" />{errors.price ? <small id="price-error" className="field-error" role="alert">{errors.price}</small> : <small id="price-help" className="field-helper">Dấu chấm được thêm tự động.</small>}</label>
      <label className="form-field">Số lượng tồn kho <span aria-hidden="true">*</span><input type="number" min="0" step="1" value={values.stock} onChange={(event) => updateValue("stock", Number(event.target.value))} onBlur={() => validateField("stock")} aria-invalid={Boolean(errors.stock)} aria-describedby={errors.stock ? "stock-error" : undefined} />{errors.stock && <small id="stock-error" className="field-error" role="alert">{errors.stock}</small>}</label>
      <label className="form-field">Danh mục <span aria-hidden="true">*</span><select value={values.category_id || ""} onChange={(event) => updateValue("category_id", Number(event.target.value))} onBlur={() => validateField("category_id")} aria-invalid={Boolean(errors.category_id)} aria-describedby={errors.category_id ? "category-error" : undefined}><option value="">Chọn danh mục</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{errors.category_id && <small id="category-error" className="field-error" role="alert">{errors.category_id}</small>}</label>
      <label className="form-field">URL hình ảnh <span className="optional">(không bắt buộc)</span><input type="url" inputMode="url" placeholder="https://example.com/image.jpg" value={values.image_url ?? ""} onChange={(event) => updateValue("image_url", event.target.value || null)} onBlur={() => validateField("image_url")} aria-invalid={Boolean(errors.image_url)} aria-describedby={errors.image_url ? "image-url-error" : undefined} />{errors.image_url && <small id="image-url-error" className="field-error" role="alert">{errors.image_url}</small>}</label>
      <label className="form-field form-field-wide">Mô tả <span className="optional">(không bắt buộc)</span><textarea rows={5} value={values.description ?? ""} onChange={(event) => updateValue("description", event.target.value || null)} /></label>
    </div>
    <div className="form-actions"><button type="button" className="secondary-button" disabled={submitting} onClick={onCancel}>Hủy</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "Đang lưu..." : submitLabel}</button></div>
  </form>;
}
