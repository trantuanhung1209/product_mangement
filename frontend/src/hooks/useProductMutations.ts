import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createProduct, deleteProduct, updateProduct, uploadProductImage } from "../api/products";
import { productKeys } from "../api/queryKeys";
import type { ProductPayload } from "../types/catalog";

interface SaveProductVariables {
  payload: ProductPayload;
  file: File | null;
  signal?: AbortSignal;
}

export function useSaveProduct(productId?: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ payload, file, signal }: SaveProductVariables) => {
      const saved = (
        productId === undefined
          ? await createProduct(payload, signal)
          : await updateProduct(productId, payload, signal)
      ).data;
      if (!file) return saved;
      return (await uploadProductImage(saved.id, file, signal)).data;
    },
    onSuccess: (product) => queryClient.setQueryData(productKeys.detail(product.id), product),
    onError: () => {
      // The update or image upload may have partly applied; do not trust cached detail.
      if (productId !== undefined) void queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) });
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
