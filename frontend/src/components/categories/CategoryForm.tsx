import { useState } from "react";

import type { Category, CategoryPayload } from "../../types/catalog";

interface CategoryFormProps {
  initialCategory?: Category;
  onCancel: () => void;
  onSubmit: (payload: CategoryPayload) => Promise<void>;
  submitLabel: string;
}

export function CategoryForm({
  initialCategory,
  onCancel,
  onSubmit,
  submitLabel,
}: CategoryFormProps) {
  const [name, setName] = useState(initialCategory?.name ?? "");
  const [description, setDescription] = useState(
    initialCategory?.description ?? "",
  );
  const [nameError, setNameError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Tên danh mục không được để trống.");
      return;
    }

    setNameError("");
    setFormError("");
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmedName,
        description: description.trim() || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể lưu danh mục.";
      if (message.startsWith("Tên danh mục")) setNameError(message);
      else setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="product-form" onSubmit={submit} noValidate>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <div className="form-grid">
        <label className="form-field form-field-wide">
          Tên danh mục <span aria-hidden="true">*</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (nameError) setNameError("");
            }}
            onBlur={() => !name.trim() && setNameError("Tên danh mục không được để trống.")}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? "category-name-error" : undefined}
            autoFocus
            maxLength={255}
            required
          />
          {nameError && (
            <small className="field-error" id="category-name-error" role="alert">
              {nameError}
            </small>
          )}
        </label>
        <label className="form-field form-field-wide">
          Mô tả <span className="optional">(không bắt buộc)</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="secondary-button" disabled={submitting} onClick={onCancel}>
          Hủy
        </button>
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? "Đang lưu..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
