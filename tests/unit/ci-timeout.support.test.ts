import { describe, expect, it } from "bun:test";

import { ciTestTimeout } from "../support/ci-timeout";

describe("ciTestTimeout", () => {
  it("keeps local test timeouts unchanged", () => {
    delete process.env.CI;

    expect(ciTestTimeout(15_000)).toBe(15_000);
  });

  it("expands test timeouts on GitHub CI", () => {
    process.env.CI = "true";

    expect(ciTestTimeout(15_000)).toBe(60_000);
  });
});
