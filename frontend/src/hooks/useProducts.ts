import { useEffect, useState } from "react";
import { isAxiosError } from "axios";

import { getProducts } from "../api/products";
import type { ProductListResponse, ProductQuery } from "../types/catalog";

interface ProductsState {
  data: ProductListResponse | null;
  error: boolean;
  loading: boolean;
}

export function useProducts(query: ProductQuery) {
  const [state, setState] = useState<ProductsState>({ data: null, error: false, loading: true });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: false }));

    void getProducts(query, controller.signal)
      .then((response) => setState({ data: response.data, error: false, loading: false }))
      .catch((error: unknown) => {
        if (isAxiosError(error) && error.code === "ERR_CANCELED") return;
        setState((current) => ({ ...current, error: true, loading: false }));
      });

    return () => controller.abort();
  }, [query, reloadKey]);

  return { ...state, retry: () => setReloadKey((key) => key + 1) };
}
