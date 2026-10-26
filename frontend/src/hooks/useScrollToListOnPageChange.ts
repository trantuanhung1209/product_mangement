import { useEffect, useRef, type RefObject } from "react";

// After the user moves to another page of a list, bring the top of that list back into view so
// they do not land in the middle of the new page. Not triggered by the first render.
export function useScrollToListOnPageChange(page: number, target: RefObject<HTMLElement | null>) {
  const previous = useRef(page);
  useEffect(() => {
    if (previous.current === page) return;
    previous.current = page;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target.current?.scrollIntoView?.({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  }, [page, target]);
}
