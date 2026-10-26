import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { createProduct, deleteProduct, updateProduct, uploadProductImage } from "../api/products";
import { productKeys } from "../api/queryKeys";
import type { ProductPayload } from "../types/catalog";

interface SaveProductVariables {
  payload: ProductPayload;
  file: File | null;
  signal?: AbortSignal;
}

// Without a productId this creates the product. Once the create succeeds its id is kept,
// so a retry after a failed image upload updates that product instead of POSTing a duplicate.
export function useSaveProduct(productId?: number) {
  const queryClient = useQueryClient();
  const createdId = useRef<number | undefined>(undefined);
  return useMutation({
    mutationFn: async ({ payload, file, signal }: SaveProductVariables) => {
      const existingId = productId ?? createdId.current;
      const saved = (
        existingId === undefined
          ? await createProduct(payload, signal)
          : await updateProduct(existingId, payload, signal)
      ).data;
      createdId.current = saved.id;
      if (!file) return saved;
      return (await uploadProductImage(saved.id, file, signal)).data;
    },
    onSuccess: (product) => queryClient.setQueryData(productKeys.detail(product.id), product),
    onError: () => {
      // The update or image upload may have partly applied; do not trust cached detail.
      const id = productId ?? createdId.current;
      if (id !== undefined) void queryClient.invalidateQueries({ queryKey: productKeys.detail(id) });
    },
    // A create can succeed while the image upload fails, so lists are stale either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: productKeys.lists() }),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productId: number) => {
      await deleteProduct(productId);
      return productId;
    },
    onSuccess: (productId) => {
      queryClient.removeQueries({ queryKey: productKeys.detail(productId), exact: true });
      return queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}
