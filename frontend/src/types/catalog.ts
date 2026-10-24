export type SortBy = "id" | "name" | "price" | "stock" | "created_at";
export type SortOrder = "asc" | "desc";

export interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string;
  stock: number;
  category_id: number;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface CategoryPayload {
  name: string;
  description: string | null;
}

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ProductQuery {
  page: number;
  page_size: number;
  search?: string;
  category_id?: number;
  min_price?: string;
  max_price?: string;
  sort_by: SortBy;
  order: SortOrder;
}

export interface ProductPayload {
  name: string;
  description: string | null;
  price: string;
  stock: number;
  category_id: number;
  image_url: string | null;
}

export interface AuthUser {
  id: number;
  email: string;
  role: "ADMIN" | "USER";
  is_active: boolean;
  created_at: string;
}

export interface LoginSession {
  session_id: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  user_agent: string;
  is_current: boolean;
}

export interface AdminUser {
  id: number;
  email: string;
  role: "ADMIN" | "USER";
  is_active: boolean;
}

export interface AdminUserList {
  items: AdminUser[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
