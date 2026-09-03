import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeInstalledHostWriteback } from "../../src/install/hostWritebackRuntime";

async function writeObserveConfig(homeRoot: string): Promise<void> {
  await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
  await writeFile(
    join(homeRoot, ".goodmemory/codex.json"),
    `${JSON.stringify({
      activationMode: "global",
      host: "codex",
      maxTokens: 128,
      retrievalProfile: "coding_agent",
      storage: {
        path: join(homeRoot, ".goodmemory/memory.sqlite"),
        provider: "sqlite",
      },
      userId: "policy-user",
      version: 1,
      writeback: { mode: "observe" },
    })}\n`,
    "utf8",
  );
}

describe("installed host writeback project policy admission", () => {
  it("admits a project policy whose rule body uses verbs outside any fixed list", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-policy-home-"));
    const workspaceRoot = await mkdtemp(join(tmpdir(), "goodmemory-policy-ws-"));
    try {
      await writeObserveConfig(homeRoot);
      const content =
        "Establish and implement the field-boundary policy for this repository. Project policy: only double quotes protect a delimiter; grouping double quotes are removed; two consecutive double quotes inside a protected field produce one literal double quote; single quotes are ordinary characters. Preserve the existing return shape.";
      const result = await executeInstalledHostWriteback({
        command: "session-end",
        homeRoot,
        host: "codex",
        payload: {
          cwd: workspaceRoot,
          messages: [{ content, role: "user" }],
          session_id: "field-boundary-policy-session",
        },
      });
      expect(result).toMatchObject({ reason: "observed", wrote: false });
      expect(result.candidates).toEqual([
        expect.objectContaining({
          content,
          durable: true,
          kind: "fact",
          reason: "confirmed_decision",
          source: "user",
        }),
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
