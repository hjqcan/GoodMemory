import { describe, expect, it } from "bun:test";

import {
  replayC6SourceV4BoundedCapture,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-replay";
import type {
  LoadedC6SourceV4BoundedSnapshot,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-snapshot";

describe("C6 source-v4 bounded capture replay authority", () => {
  it("rejects an object cast as a snapshot before consuming a request ledger", async () => {
    await expect(
      replayC6SourceV4BoundedCapture({
        requests: [],
        snapshot: {} as
          LoadedC6SourceV4BoundedSnapshot,
      }),
    ).rejects.toThrow("requires a verified snapshot");
  });
});
