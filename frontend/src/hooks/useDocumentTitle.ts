import { useEffect } from "react";

export const APP_TITLE = "Product Catalog";

// Sets the browser tab / history title for the current screen. Pass undefined while the real
// title (for example a product name) is still loading, so the tab shows the app name only.
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_TITLE}` : APP_TITLE;
  }, [title]);
}
