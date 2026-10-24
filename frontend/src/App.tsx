import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";

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
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <section className="state-panel">
        <p>Đang kiểm tra quyền truy cập.</p>
      </section>
    );
  if (user?.role !== "ADMIN")
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  return children;
}

function AuthenticatedRoute({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <section className="state-panel">
        <p>Đang kiểm tra phiên đăng nhập.</p>
      </section>
    );
  if (!user)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  return children;
}

function LegacyProductRedirect() {
  const { productId } = useParams();
  const location = useLocation();
  const suffix = location.pathname.endsWith("/edit") ? "/edit" : "";
  const path = productId ? `/admin/products/${productId}${suffix}` : "/admin/products";
  return <Navigate to={`${path}${location.search}`} replace />;
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route
            path="/"
            element={
              <StorefrontShell>
                <StorefrontHomePage />
              </StorefrontShell>
            }
          />
          <Route
            path="/shop"
            element={
              <StorefrontShell>
                <StorefrontShopPage />
              </StorefrontShell>
            }
          />
          <Route
            path="/shop/:productId"
            element={
              <StorefrontShell>
                <StorefrontProductPage />
              </StorefrontShell>
            }
          />
          <Route
            path="/admin/products"
            element={
              <AdminRoute>
                <AppShell>
                  <ProductsPage />
                </AppShell>
              </AdminRoute>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/account/sessions"
            element={
              <AuthenticatedRoute>
                <AppShell>
                  <SessionsPage />
                </AppShell>
              </AuthenticatedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <AdminRoute>
                <AppShell>
                  <AdminUsersPage />
                </AppShell>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/users/:userId/sessions"
            element={
              <AdminRoute>
                <AppShell>
                  <AdminUserSessionsPage />
                </AppShell>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/products/new"
            element={
              <AdminRoute>
                <AppShell>
                  <ProductFormPage mode="create" />
                </AppShell>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/products/:productId"
            element={
              <AdminRoute>
                <AppShell>
                  <ProductDetailPage />
                </AppShell>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/products/:productId/edit"
            element={
              <AdminRoute>
                <AppShell>
                  <ProductFormPage mode="edit" />
                </AppShell>
              </AdminRoute>
            }
          />
          <Route path="/products" element={<AdminRoute><LegacyProductRedirect /></AdminRoute>} />
          <Route path="/products/new" element={<AdminRoute><Navigate to="/admin/products/new" replace /></AdminRoute>} />
          <Route path="/products/:productId/edit" element={<AdminRoute><LegacyProductRedirect /></AdminRoute>} />
          <Route path="/products/:productId" element={<AdminRoute><LegacyProductRedirect /></AdminRoute>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
