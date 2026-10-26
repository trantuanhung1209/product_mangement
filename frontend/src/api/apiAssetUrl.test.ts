import { afterEach, describe, expect, it } from "vitest";

import { api, apiAssetUrl } from "./client";

describe("apiAssetUrl", () => {
  const originalBaseUrl = api.defaults.baseURL;
  afterEach(() => { api.defaults.baseURL = originalBaseUrl; });

  it("resolves against the API origin when one is configured", () => {
    api.defaults.baseURL = "http://api.test:8000";
    expect(apiAssetUrl("/api/v1/products/1/image")).toBe("http://api.test:8000/api/v1/products/1/image");
  });

  it("falls back to the page origin when VITE_API_URL is empty (same-origin behind Nginx)", () => {
    api.defaults.baseURL = "";
    expect(apiAssetUrl("/api/v1/products/1/image")).toBe(`${window.location.origin}/api/v1/products/1/image`);
  });

  it("leaves absolute URLs untouched", () => {
    api.defaults.baseURL = "";
    expect(apiAssetUrl("https://cdn.test/a.webp")).toBe("https://cdn.test/a.webp");
  });
});
