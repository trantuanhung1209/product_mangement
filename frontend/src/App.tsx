import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/layout/AppShell";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ProductFormPage } from "./pages/ProductFormPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ToastProvider } from "./components/feedback/Toast";

export function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/products" replace />} />
        <Route path="/products" element={<AppShell><ProductsPage /></AppShell>} />
        <Route path="/products/new" element={<AppShell><ProductFormPage mode="create" /></AppShell>} />
        <Route path="/products/:productId" element={<AppShell><ProductDetailPage /></AppShell>} />
        <Route path="/products/:productId/edit" element={<AppShell><ProductFormPage mode="edit" /></AppShell>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ToastProvider>
  );
}
