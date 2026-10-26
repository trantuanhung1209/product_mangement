import Lenis from "lenis";
import { useEffect } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// Page-wide smooth scrolling. It is switched off whenever the user asks for reduced motion (and
// follows that setting if it changes while the page is open). Areas that scroll on their own, such
// as modals, opt out with data-lenis-prevent.
export function SmoothScroll() {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION);
    let lenis: Lenis | null = null;
    const sync = () => {
      if (query.matches) {
        lenis?.destroy();
        lenis = null;
      } else if (!lenis) {
        lenis = new Lenis({ autoRaf: true });
      }
    };
    sync();
    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
      lenis?.destroy();
    };
  }, []);
  return null;
}
