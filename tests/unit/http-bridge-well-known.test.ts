import { describe, expect, it } from "bun:test";

import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src";
import { buildGoodMemoryCapabilityDescriptor } from "../../src/api/capabilityDescriptor";
import { createGoodMemoryHttpMemoryBridge } from "../../src/http";

function buildBridge() {
  const memory = createGoodMemory({
    adapters: {
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
      vectorStore: createInMemoryVectorStore(),
    },
    storage: { provider: "memory" },
  });
  // authorize denies everything: proves the well-known route never reaches it.
  return createGoodMemoryHttpMemoryBridge({
    authorize: async () => ({ authorized: false }),
    memory,
  });
}

describe("http bridge capability discovery", () => {
  it("serves the capability descriptor at /.well-known/goodmemory.json without auth", async () => {
    const bridge = buildBridge();
    const response = await bridge.handle(
      new Request("http://localhost/.well-known/goodmemory.json", {
        method: "GET",
      }),
    );

    expect(response.statusCode).toBe(200);
    const body = response.body as unknown as ReturnType<
      typeof buildGoodMemoryCapabilityDescriptor
    >;
    // Same object the committed static file is generated from — no drift.
    expect(body).toEqual(buildGoodMemoryCapabilityDescriptor());
    expect(body.name).toBe("goodmemory");
    expect(body.kind).toBe("memory-layer");
    expect(body.onboarding).toHaveLength(4);
    expect(body.mcp.command).toBe("goodmemory-mcp");
    expect(body.http.endpoints.recall).toBe("POST /memory/recall-context");
  });

  it("is GET-only discovery, not a memory operation", async () => {
    const bridge = buildBridge();
    const response = await bridge.handle(
      new Request("http://localhost/.well-known/goodmemory.json", {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.statusCode).toBe(404);
  });
});
