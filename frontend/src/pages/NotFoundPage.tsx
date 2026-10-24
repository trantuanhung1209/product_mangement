import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="not-found">
      <h1>Không tìm thấy trang</h1>
      <p>Đường dẫn này không còn tồn tại hoặc đã được thay đổi.</p>
      <Link to="/products"><ArrowLeft size={17} aria-hidden="true" /> Về danh sách sản phẩm</Link>
    </main>
  );
}
