import { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";

import { createQueryClient, shouldRetryQuery } from "./queryClient";

const httpError = (status: number) =>
  new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, { status } as AxiosResponse);

describe("shouldRetryQuery", () => {
  it.each([400, 401, 403, 404, 409, 422, 429])("does not retry %i", (status) => {
    expect(shouldRetryQuery(0, httpError(status))).toBe(false);
  });

  it("retries 5xx and network errors at most twice", () => {
    for (const error of [httpError(500), httpError(503), new AxiosError("Network Error", "ERR_NETWORK")]) {
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(1, error)).toBe(true);
      expect(shouldRetryQuery(2, error)).toBe(false);
    }
  });

  it("does not retry cancelled requests", () => {
    expect(shouldRetryQuery(0, new AxiosError("canceled", "ERR_CANCELED"))).toBe(false);
  });
});

describe("createQueryClient", () => {
  it("never retries mutations and returns an independent client each time", () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
    expect(createQueryClient()).not.toBe(client);
  });
});
