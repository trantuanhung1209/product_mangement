import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebounce } from "./useDebounce";

// The assignment (docs/ThucHanh-Tuan2.md) asks for a 500 ms search debounce.
describe("useDebounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits 500 ms by default and only keeps the latest value", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value), { initialProps: { value: "a" } });
    rerender({ value: "ab" });
    act(() => { vi.advanceTimersByTime(499); });
    expect(result.current).toBe("a");
    rerender({ value: "abc" });
    act(() => { vi.advanceTimersByTime(499); });
    expect(result.current).toBe("a"); // typing again restarted the wait
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe("abc");
  });
});
