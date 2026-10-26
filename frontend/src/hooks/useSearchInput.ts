import { useCallback, useEffect, useState } from "react";

import { useDebounce } from "./useDebounce";

// Keeps a search box and the URL in step. The text is committed to the URL only once the
// debounced value has caught up with what is typed. A debounced value that lags behind (after
// "clear", or after the URL changed through browser history) must never be written back, or it
// would undo the change that just happened.
export function useSearchInput(urlSearch: string | undefined, commit: (search: string | undefined) => void) {
  const [state, setState] = useState({ url: urlSearch, text: urlSearch ?? "" });
  // When the URL changes, replace the text during render (not in an effect), so the commit effect
  // below never runs once with the new URL and the old text.
  if (state.url !== urlSearch) setState({ url: urlSearch, text: urlSearch ?? "" });
  const input = state.text;
  const setInput = useCallback((text: string) => setState((current) => ({ ...current, text })), []);
  const debounced = useDebounce(input);

  useEffect(() => {
    if (debounced !== input) return;
    const next = input.trim() || undefined;
    if (next !== urlSearch) commit(next);
  }, [debounced, input, urlSearch, commit]);

  return [input, setInput] as const;
}
