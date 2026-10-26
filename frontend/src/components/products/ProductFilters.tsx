import { useCallback, useEffect, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";

import { useDebounce } from "../../hooks/useDebounce";
import type { Category, SortBy, SortOrder } from "../../types/catalog";

interface ProductFiltersProps {
  categories: Category[];
  categoryId?: number;
  maxPrice?: string;
  minPrice?: string;
  search: string;
  sortBy: SortBy;
  order: SortOrder;
  onSearchChange: (value: string) => void;
  onChange: (changes: Record<string, string | undefined>) => void;
}

const sortOptions: Array<{ label: string; sortBy: SortBy; order: SortOrder }> = [
  { label: "Mới nhất", sortBy: "created_at", order: "desc" },
  { label: "Cũ nhất", sortBy: "created_at", order: "asc" },
  { label: "Tên A–Z", sortBy: "name", order: "asc" },
  { label: "Tên Z–A", sortBy: "name", order: "desc" },
  { label: "Giá thấp đến cao", sortBy: "price", order: "asc" },
  { label: "Giá cao đến thấp", sortBy: "price", order: "desc" },
  { label: "Tồn kho tăng dần", sortBy: "stock", order: "asc" },
  { label: "Tồn kho giảm dần", sortBy: "stock", order: "desc" },
];

export function ProductFilters({ categories, categoryId, maxPrice, minPrice, search, sortBy, order, onSearchChange, onChange }: ProductFiltersProps) {
  const [minPriceInput, setMinPriceInput] = useState(minPrice ?? "");
  const [maxPriceInput, setMaxPriceInput] = useState(maxPrice ?? "");
  const debouncedMinPrice = useDebounce(minPriceInput);
  const debouncedMaxPrice = useDebounce(maxPriceInput);
  const selectedSort = `${sortBy}:${order}`;
  const hasFilters = Boolean(search || categoryId || minPrice || maxPrice || sortBy !== "created_at" || order !== "desc");

  useEffect(() => setMinPriceInput(minPrice ?? ""), [minPrice]);
  useEffect(() => setMaxPriceInput(maxPrice ?? ""), [maxPrice]);

  const commitPrice = useCallback((key: "min_price" | "max_price", value: string, currentValue: string | undefined) => {
    const normalized = value.trim().replace(",", ".");
    if (!normalized || (Number.isFinite(Number(normalized)) && Number(normalized) >= 0)) {
      if (normalized === (currentValue ?? "")) return true;
      onChange({ [key]: normalized || undefined });
      return true;
    }
    return false;
  }, [onChange]);

  // Commit only once the debounced text has caught up with the input. A lagging value (just after
  // "clear", or after the URL changed through history) must not be written back over that change.
  useEffect(() => { if (debouncedMinPrice === minPriceInput) commitPrice("min_price", debouncedMinPrice, minPrice); }, [commitPrice, debouncedMinPrice, minPriceInput, minPrice]);
  useEffect(() => { if (debouncedMaxPrice === maxPriceInput) commitPrice("max_price", debouncedMaxPrice, maxPrice); }, [commitPrice, debouncedMaxPrice, maxPriceInput, maxPrice]);

  const resetInvalidPrice = (key: "min_price" | "max_price", value: string, fallback: string | undefined) => {
    if (commitPrice(key, value, fallback)) return;
    if (key === "min_price") setMinPriceInput(fallback ?? "");
    else setMaxPriceInput(fallback ?? "");
  };

  const clearFilters = () => {
    onSearchChange("");
    setMinPriceInput("");
    setMaxPriceInput("");
    onChange({ search: undefined, category_id: undefined, min_price: undefined, max_price: undefined, sort_by: undefined, order: undefined });
  };

  return (
    <section className="filters" aria-label="Tìm kiếm và bộ lọc">
      <label className="search-field">
        <Search size={18} aria-hidden="true" />
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Tìm kiếm sản phẩm" aria-label="Tìm kiếm sản phẩm" />
        {search && <button type="button" className="icon-button" onClick={() => { onSearchChange(""); onChange({ search: undefined }); }} aria-label="Xóa tìm kiếm"><X size={16} aria-hidden="true" /></button>}
      </label>
      <div className="filter-controls">
        <label><span>Danh mục</span><select value={categoryId ?? ""} onChange={(event) => onChange({ category_id: event.target.value || undefined })}><option value="">Tất cả danh mục</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label><span>Giá thấp nhất</span><input type="text" inputMode="decimal" value={minPriceInput} onChange={(event) => setMinPriceInput(event.target.value)} onBlur={() => resetInvalidPrice("min_price", minPriceInput, minPrice)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} /></label>
        <label><span>Giá cao nhất</span><input type="text" inputMode="decimal" value={maxPriceInput} onChange={(event) => setMaxPriceInput(event.target.value)} onBlur={() => resetInvalidPrice("max_price", maxPriceInput, maxPrice)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} /></label>
        <label><span><SlidersHorizontal size={14} aria-hidden="true" /> Sắp xếp</span><select value={selectedSort} onChange={(event) => { const [nextSortBy, nextOrder] = event.target.value.split(":") as [SortBy, SortOrder]; onChange({ sort_by: nextSortBy, order: nextOrder }); }}>{sortOptions.map((option) => <option key={`${option.sortBy}:${option.order}`} value={`${option.sortBy}:${option.order}`}>{option.label}</option>)}</select></label>
      </div>
      {hasFilters && <button type="button" className="clear-filters" onClick={clearFilters}>Xóa bộ lọc</button>}
    </section>
  );
}
