import { useState } from "react";
import { isAxiosError } from "axios";
import { LockKeyhole } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login, user } = useAuth(); const location = useLocation(); const navigate = useNavigate();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  if (user) return <Navigate to="/products" replace />;
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setError(""); setSubmitting(true); try { await login(email, password); navigate((location.state as { from?: string } | null)?.from ?? "/products", { replace: true }); } catch (requestError) { setError(isAxiosError(requestError) && requestError.response?.status === 401 ? "Email hoặc mật khẩu không đúng." : "Không thể đăng nhập. Vui lòng thử lại."); } finally { setSubmitting(false); } };
  return <main className="login-page"><form className="login-card" onSubmit={submit}><span className="brand-mark"><LockKeyhole size={20} aria-hidden="true" /></span><h1>Đăng nhập</h1><p>Đăng nhập tài khoản quản trị Product Catalog.</p>{error && <p className="form-error" role="alert">{error}</p>}<label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></label><label>Mật khẩu<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="primary-button" disabled={submitting}>{submitting ? "Đang đăng nhập..." : "Đăng nhập"}</button></form></main>;
}
