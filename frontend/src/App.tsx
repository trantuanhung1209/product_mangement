import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { AppShell } from "./components/layout/AppShell";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ProductFormPage } from "./pages/ProductFormPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ToastProvider } from "./components/feedback/Toast";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { SessionsPage } from "./pages/SessionsPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminUserSessionsPage } from "./pages/AdminUserSessionsPage";
import { StorefrontHomePage } from "./pages/StorefrontHomePage";
import { StorefrontProductPage } from "./pages/StorefrontProductPage";
import { StorefrontShopPage } from "./pages/StorefrontShopPage";
import { StorefrontShell } from "./components/storefront/StorefrontShell";

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth(); const location = useLocation();
  if (loading) return <section className="state-panel"><p>Đang kiểm tra quyền truy cập.</p></section>;
  if (user?.role !== "ADMIN") return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return children;
}

export function App() {
  return (
    <AuthProvider><ToastProvider>
      <Routes>
        <Route path="/" element={<StorefrontShell><StorefrontHomePage /></StorefrontShell>} />
        <Route path="/shop" element={<StorefrontShell><StorefrontShopPage /></StorefrontShell>} />
        <Route path="/shop/:productId" element={<StorefrontShell><StorefrontProductPage /></StorefrontShell>} />
        <Route path="/products" element={<AppShell><ProductsPage /></AppShell>} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/account/sessions" element={<AppShell><SessionsPage /></AppShell>} />
        <Route path="/admin/users" element={<AppShell><AdminRoute><AdminUsersPage /></AdminRoute></AppShell>} />
        <Route path="/admin/users/:userId/sessions" element={<AppShell><AdminRoute><AdminUserSessionsPage /></AdminRoute></AppShell>} />
        <Route path="/products/new" element={<AppShell><AdminRoute><ProductFormPage mode="create" /></AdminRoute></AppShell>} />
        <Route path="/products/:productId" element={<AppShell><ProductDetailPage /></AppShell>} />
        <Route path="/products/:productId/edit" element={<AppShell><AdminRoute><ProductFormPage mode="edit" /></AdminRoute></AppShell>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ToastProvider></AuthProvider>
  );
}
