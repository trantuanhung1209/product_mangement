import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isAxiosError } from "axios";

import * as cartApi from "../api/cart";
import { useAuth } from "../auth/AuthContext";
import type { Cart } from "../types/catalog";

const emptyCart: Cart = { items: [], total_quantity: 0, subtotal: "0" };

interface CartValue {
  cart: Cart;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addItem: (productId: number, quantity: number) => Promise<void>;
  updateItem: (productId: number, quantity: number) => Promise<void>;
  removeItem: (productId: number) => Promise<void>;
  clear: () => Promise<void>;
}

const CartContext = createContext<CartValue | null>(null);

function cartErrorMessage(error: unknown) {
  if (!isAxiosError(error)) return "Không thể cập nhật giỏ hàng. Vui lòng thử lại.";
  if (error.response?.status === 404) return "Sản phẩm hoặc mục trong giỏ hàng không còn tồn tại.";
  if (error.response?.status === 409) return "Số lượng yêu cầu vượt quá tồn kho hiện có.";
  return "Không thể cập nhật giỏ hàng. Vui lòng thử lại.";
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { loading: authLoading, user } = useAuth();
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const activeUserId = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const userId = user?.id;
    if (!userId) return;
    try {
      const response = await cartApi.getCart();
      if (activeUserId.current === userId) {
        setCart(response.data);
        setError(null);
      }
    } catch (requestError) {
      if (isAxiosError(requestError) && requestError.code === "ERR_CANCELED") return;
      if (activeUserId.current === userId) setError(cartErrorMessage(requestError));
      throw requestError;
    }
  }, [user]);

  useEffect(() => {
    const version = ++requestVersion.current;
    activeUserId.current = user?.id ?? null;
    setCart(emptyCart);
    setError(null);
    if (authLoading || !user) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void cartApi
      .getCart(controller.signal)
      .then((response) => {
        if (requestVersion.current === version) setCart(response.data);
      })
      .catch((requestError: unknown) => {
        if (isAxiosError(requestError) && requestError.code === "ERR_CANCELED") return;
        if (requestVersion.current === version) setError(cartErrorMessage(requestError));
      })
      .finally(() => {
        if (requestVersion.current === version) setLoading(false);
      });
    return () => controller.abort();
  }, [authLoading, user]);

  const mutate = useCallback(async (request: () => Promise<{ data: Cart }>) => {
    const userId = activeUserId.current;
    try {
      const response = await request();
      if (activeUserId.current === userId) {
        setCart(response.data);
        setError(null);
      }
    } catch (requestError) {
      const message = cartErrorMessage(requestError);
      if (activeUserId.current === userId) setError(message);
      throw new Error(message, { cause: requestError });
    }
  }, []);

  const addItem = useCallback(
    (productId: number, quantity: number) => mutate(() => cartApi.addCartItem(productId, quantity)),
    [mutate],
  );
  const updateItem = useCallback(
    (productId: number, quantity: number) => mutate(() => cartApi.updateCartItem(productId, quantity)),
    [mutate],
  );
  const removeItem = useCallback(
    async (productId: number) => {
      const userId = activeUserId.current;
      try {
        await cartApi.removeCartItem(productId);
        await refresh();
      } catch (requestError) {
        const message = cartErrorMessage(requestError);
        if (activeUserId.current === userId) setError(message);
        throw new Error(message, { cause: requestError });
      }
    },
    [refresh],
  );
  const clear = useCallback(async () => {
    const userId = activeUserId.current;
    try {
      await cartApi.clearCart();
      if (activeUserId.current === userId) {
        setCart(emptyCart);
        setError(null);
      }
    } catch (requestError) {
      const message = cartErrorMessage(requestError);
      if (activeUserId.current === userId) setError(message);
      throw new Error(message, { cause: requestError });
    }
  }, []);

  return (
    <CartContext.Provider value={{ cart, loading, error, refresh, addItem, updateItem, removeItem, clear }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider.");
  return context;
}
