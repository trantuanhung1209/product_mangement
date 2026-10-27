import { describe, expect, it } from "vitest";

import { defaultProductImage } from "./defaultProductImage";

describe("defaultProductImage", () => {
  it("uses three different images, cycling by product id", () => {
    const images = [1, 2, 3].map(defaultProductImage);
    expect(new Set(images).size).toBe(3);
    expect(defaultProductImage(4)).toBe(images[0]);
    expect(defaultProductImage(5)).toBe(images[1]);
    expect(defaultProductImage(6)).toBe(images[2]);
  });

  it("always gives the same image to the same product", () => {
    expect(defaultProductImage(42)).toBe(defaultProductImage(42));
  });
});
