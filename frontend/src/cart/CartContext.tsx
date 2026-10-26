import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import * as cartApi from "../api/cart";
import { cartKeys } from "../api/queryKeys";
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
  const queryClient = useQueryClient();
  const userId = user?.id;
  // Tagged with the user so one account's mutation error is never shown to the next.
  const [mutationError, setMutationError] = useState<{ userId: number | undefined; message: string } | null>(null);

  const cartQuery = useQuery({
    queryKey: cartKeys.user(userId ?? 0),
    queryFn: async ({ signal }) => (await cartApi.getCart(signal)).data,
    enabled: !authLoading && userId !== undefined,
    staleTime: 0,
  });

  // Every mutation refetches the cart afterwards (also on failure: a 409 means stock changed).
  const mutation = useMutation({
    mutationFn: (request: () => Promise<unknown>) => request(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: cartKeys.all }),
  });

  const { mutateAsync } = mutation;
  const { refetch } = cartQuery;

  const mutate = useCallback(
    async (request: () => Promise<unknown>) => {
      try {
        await mutateAsync(request);
        setMutationError(null);
      } catch (requestError) {
        const message = cartErrorMessage(requestError);
        setMutationError({ userId, message });
        throw new Error(message, { cause: requestError });
      }
    },
    [mutateAsync, userId],
  );

  const refresh = useCallback(async () => {
    try {
      await refetch({ throwOnError: true });
      setMutationError(null);
    } catch (requestError) {
      if (isAxiosError(requestError) && requestError.code === "ERR_CANCELED") return;
      throw requestError;
    }
  }, [refetch]);

  const addItem = useCallback((productId: number, quantity: number) => mutate(() => cartApi.addCartItem(productId, quantity)), [mutate]);
  const updateItem = useCallback((productId: number, quantity: number) => mutate(() => cartApi.updateCartItem(productId, quantity)), [mutate]);
  const removeItem = useCallback((productId: number) => mutate(() => cartApi.removeCartItem(productId)), [mutate]);
  const clear = useCallback(() => mutate(() => cartApi.clearCart()), [mutate]);

  const value: CartValue = {
    cart: userId !== undefined ? (cartQuery.data ?? emptyCart) : emptyCart,
    loading: userId !== undefined && cartQuery.isLoading,
    error: (mutationError && mutationError.userId === userId ? mutationError.message : null) ?? (userId !== undefined && cartQuery.isError ? cartErrorMessage(cartQuery.error) : null),
    refresh,
    addItem,
    updateItem,
    removeItem,
    clear,
  };
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider.");
  return context;
}
