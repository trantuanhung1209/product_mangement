import { useState } from "react";
import { isAxiosError } from "axios";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { PasswordInput } from "../components/feedback/PasswordInput";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function LoginPage() {
  useDocumentTitle("Đăng nhập");
  const { login, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestedPath = (location.state as { from?: string } | null)?.from;
  const safePublicPath = requestedPath?.startsWith("/") && !requestedPath.startsWith("//") && !requestedPath.startsWith("/admin")
    ? requestedPath
    : "/shop";
  if (user)
    return <Navigate to={user.role === "ADMIN" ? requestedPath ?? "/admin/products" : safePublicPath} replace />;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const authenticatedUser = await login(email, password);
      navigate(
        authenticatedUser.role === "ADMIN"
          ? requestedPath ?? "/admin/products"
          : safePublicPath,
        { replace: true },
      );
    } catch (requestError) {
      setError(
        isAxiosError(requestError) && requestError.response?.status === 401
          ? "Email hoặc mật khẩu không đúng."
          : "Không thể đăng nhập. Vui lòng thử lại.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-intro">
        <span className="brand-mark">
          <LockKeyhole size={20} aria-hidden="true" />
        </span>
        <p className="eyebrow">PRODUCT CATALOG</p>
        <h1>
          Quản lý danh mục
          <br />
          một cách gọn gàng.
        </h1>
        <p>Đăng nhập để thêm, chỉnh sửa và duy trì dữ liệu sản phẩm.</p>
      </section>
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">KHU VỰC QUẢN TRỊ</p>
        <h2>Chào mừng trở lại</h2>
        <p>Nhập thông tin tài khoản để tiếp tục.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="admin@example.com"
            required
            autoFocus
          />
        </label>
        <PasswordInput
          label="Mật khẩu"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <button className="primary-button login-submit" disabled={submitting}>
          {submitting ? (
            "Đang đăng nhập..."
          ) : (
            <>
              Đăng nhập <ArrowRight size={16} aria-hidden="true" />
            </>
          )}
        </button>
        <p className="auth-switch">
          Chưa có tài khoản? <Link to="/register">Đăng ký</Link>
        </p>
      </form>
    </main>
  );
}
