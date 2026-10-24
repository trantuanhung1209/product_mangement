import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onChange: (changes: Record<string, string | undefined>, resetPage?: boolean) => void;
}

export function Pagination({ page, pageSize, total, totalPages, onChange }: PaginationProps) {
  return <footer className="pagination"><p>{total > 0 ? `Tổng ${new Intl.NumberFormat("vi-VN").format(total)} sản phẩm` : "Không có sản phẩm"}</p><div className="pagination-controls"><label>Số dòng<select value={pageSize} onChange={(event) => onChange({ page_size: event.target.value, page: "1" }, false)}>{[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label><span>Trang {totalPages === 0 ? 0 : page} / {totalPages}</span><button type="button" aria-label="Trang trước" disabled={page <= 1 || totalPages === 0} onClick={() => onChange({ page: String(page - 1) }, false)}><ChevronLeft size={18} aria-hidden="true" /></button><button type="button" aria-label="Trang sau" disabled={page >= totalPages || totalPages === 0} onClick={() => onChange({ page: String(page + 1) }, false)}><ChevronRight size={18} aria-hidden="true" /></button></div></footer>;
}
