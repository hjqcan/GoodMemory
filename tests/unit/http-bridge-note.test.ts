import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createGoodMemoryHttpMemoryBridge } from "../../src/http";

const scope = { userId: "http-note-user", workspaceId: "workspace-a" };
const BODY = "# Reading MediaWiki\n\nMost MediaWiki sites expose api.php.\n";

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-goodmemory-operations": "remember,recall-context,export",
      "x-goodmemory-user-id": scope.userId,
      "x-goodmemory-workspace-id": scope.workspaceId,
    },
    method: "POST",
  });
}

function noteAnnotation(overrides: Record<string, unknown> = {}) {
  return {
    messageIndex: 0,
    remember: "always",
    confirmed: true,
    kindHint: "note",
    metadataPatch: { noteTitle: "Reading MediaWiki sites as an agent" },
    ...overrides,
  };
}

describe("http bridge note writes", () => {
  it("accepts kindHint note and stores the page verbatim", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const bridge = createGoodMemoryHttpMemoryBridge({ memory });

    const response = await bridge.handle(post("/memory/remember", {
      scope,
      messages: [{ role: "assistant", content: BODY }],
      annotations: [noteAnnotation()],
    }));

    expect(response.statusCode).toBe(200);
    const result = (response.body as { result: { accepted: number; events: Array<{ memoryType: string }> } }).result;
    expect(result.accepted).toBe(1);
    expect(result.events[0]?.memoryType).toBe("note");
    const exported = await memory.exportMemory({ scope });
    expect(exported.durable.notes?.[0]?.body).toBe(BODY);
  });

  it("rejects an oversize note body before writing", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const bridge = createGoodMemoryHttpMemoryBridge({ memory });

    const response = await bridge.handle(post("/memory/remember", {
      scope,
      messages: [{ role: "assistant", content: "x".repeat(8193) }],
      annotations: [noteAnnotation()],
    }));

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.body)).toContain("note_too_large");
    expect((await memory.exportMemory({ scope })).durable.notes ?? []).toHaveLength(0);
  });

  it("names note among the accepted kind hints", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const bridge = createGoodMemoryHttpMemoryBridge({ memory });

    const response = await bridge.handle(post("/memory/remember", {
      scope,
      messages: [{ role: "user", content: "hello" }],
      annotations: [{ messageIndex: 0, kindHint: "bogus" }],
    }));

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.body)).toContain("reference, note, fact");
  });
});
