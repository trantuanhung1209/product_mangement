import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const instances: { options: unknown; destroy: ReturnType<typeof vi.fn> }[] = [];
vi.mock("lenis", () => ({
  default: class FakeLenis {
    destroy = vi.fn();
    constructor(public options: unknown) {
      instances.push(this);
    }
  },
}));

import { SmoothScroll } from "./SmoothScroll";

type Listener = (event: { matches: boolean }) => void;

function stubReducedMotion(initial: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initial,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return {
    listeners,
    change(matches: boolean) {
      query.matches = matches;
      listeners.forEach((listener) => listener({ matches }));
    },
  };
}

beforeEach(() => {
  instances.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("SmoothScroll", () => {
  it("starts Lenis with its own animation loop and destroys it on unmount", () => {
    stubReducedMotion(false);
    const { unmount } = render(<SmoothScroll />);

    expect(instances).toHaveLength(1);
    expect(instances[0].options).toEqual({ autoRaf: true });
    unmount();
    expect(instances[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("does not start when the user prefers reduced motion", () => {
    const motion = stubReducedMotion(true);
    const { unmount } = render(<SmoothScroll />);

    expect(instances).toHaveLength(0);
    unmount();
    expect(motion.listeners.size).toBe(0);
  });

  it("follows the preference when it changes while the page is open, without leaking instances", () => {
    const motion = stubReducedMotion(false);
    const { unmount } = render(<SmoothScroll />);
    expect(instances).toHaveLength(1);

    motion.change(true);
    expect(instances[0].destroy).toHaveBeenCalledTimes(1);

    motion.change(false);
    expect(instances).toHaveLength(2);
    motion.change(false); // already running: no second instance
    expect(instances).toHaveLength(2);

    unmount();
    expect(instances[1].destroy).toHaveBeenCalledTimes(1);
    expect(motion.listeners.size).toBe(0);
  });
});
