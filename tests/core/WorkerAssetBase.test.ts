import { afterEach, describe, expect, it } from "vitest";
import { workerAssetBase } from "../../src/core/worker/WorkerClient";

afterEach(() => {
  window.BOOTSTRAP_CONFIG = undefined;
});

describe("worker asset base", () => {
  it("gives the inlined Blob worker the page origin for a same-origin build", () => {
    window.BOOTSTRAP_CONFIG = { cdnBase: "" };
    expect(workerAssetBase()).toBe(location.origin);
    expect(workerAssetBase()).toMatch(/^https?:\/\//);
  });

  it("keeps an explicit CDN base", () => {
    window.BOOTSTRAP_CONFIG = { cdnBase: "https://cdn.example.com" };
    expect(workerAssetBase()).toBe("https://cdn.example.com");
  });
});
