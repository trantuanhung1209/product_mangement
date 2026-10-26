import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function NotFoundPage() {
  useDocumentTitle("Không tìm thấy trang");
  return (
    <main className="not-found">
      <h1>Không tìm thấy trang</h1>
      <p>Đường dẫn này không còn tồn tại hoặc đã được thay đổi.</p>
      <Link to="/shop">
        <ArrowLeft size={17} aria-hidden="true" /> Về cửa hàng
      </Link>
    </main>
  );
}
