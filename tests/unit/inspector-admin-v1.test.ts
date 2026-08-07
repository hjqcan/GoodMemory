import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GoodMemory, RecallResult } from "../../src/api/contracts";
import { scopeToKey } from "../../src/domain/scope";
import { appendInspectorAuditEvent } from "../../src/inspector/auditLog";
import { createInspectorApp, type InspectorApp } from "../../src/inspector/public";
import { buildWritebackScopeDigest } from "../../src/install/hostWritebackAuditLedger";
import {
  buildReviewCandidateId,
  persistReviewCandidates,
} from "../../src/install/hostReviewQueue";
import { createInMemoryDocumentStore } from "../../src/storage/memory";
import {
  PROJECTION_SEARCH_SCHEMA_VERSION,
  RECALL_PROJECTION_PIPELINE_VERSION,
  SCOPE_CATALOG_COLLECTION,
  type ScopeCatalogProjection,
} from "../../src/recall/projections/contracts";
import {
  createNoopGoodMemoryJobsFacade,
  createNoopGoodMemoryRuntimeFacade,
} from "../../src/testing/fakes";

const TOKEN = "admin-v1-test-token";
const SCOPE = { userId: "admin-user", workspaceId: "admin-workspace" } as const;
const SCOPE_KEY = scopeToKey(SCOPE);

interface MemoryCalls {
  deleteAll: number;
  forget: number;
  recall: number;
  remember: number;
  revise: number;
}

function buildMemory(): { calls: MemoryCalls; memory: GoodMemory } {
  const calls = { deleteAll: 0, forget: 0, recall: 0, remember: 0, revise: 0 };
  const recallResult = {
    archives: [],
    episodes: [],
    evidence: [],
    facts: [],
    feedback: [],
    journal: null,
    metadata: {
      candidateTraces: [],
      hits: [],
      latencyMs: 3,
      policyApplied: ["admin_trace"],
      routingDecision: { strategy: "lexical" },
      tokenCount: 4,
      verificationHints: [],
    },
    packet: {},
    preferences: [],
    profile: null,
    references: [],
    workingMemory: null,
  } as unknown as RecallResult;
  return {
    calls,
    memory: {
      jobs: createNoopGoodMemoryJobsFacade(),
      runtime: createNoopGoodMemoryRuntimeFacade(),
      async buildContext() {
        throw new Error("not used");
      },
      async deleteAllMemory() {
        calls.deleteAll += 1;
        return {
          deleted: {
            archives: 0,
            artifactSpills: 0,
            episodes: 0,
            evidence: 0,
            experiences: 0,
            facts: 2,
            feedback: 0,
            journal: 0,
            preferences: 0,
            profiles: 0,
            promotions: 0,
            proposals: 0,
            references: 0,
            workingMemory: 0,
          },
          scope: SCOPE,
        };
      },
      async exportMemory() {
        throw new Error("not used");
      },
      async feedback() {
        throw new Error("not used");
      },
      async forget() {
        calls.forget += 1;
        return { forgotten: true, traceId: "forget-trace" };
      },
      async recall() {
        calls.recall += 1;
        return recallResult;
      },
      async remember() {
        calls.remember += 1;
        return {
          accepted: 1,
          events: [{
            candidateId: "candidate-1",
            memoryId: "approved-memory",
            memoryType: "preference",
            outcome: "written",
          }],
          rejected: 0,
        };
      },
      async reviseMemory(input) {
        calls.revise += 1;
        return {
          outcome: "superseded",
          supersedeLineage: {
            supersededBy: `revision-${input.target.memoryId}`,
            supersedes: input.target.memoryId,
          },
        } as Awaited<ReturnType<GoodMemory["reviseMemory"]>>;
      },
      async runMaintenance() {
        throw new Error("not used");
      },
    } as GoodMemory,
  };
}

let app: InspectorApp;
let calls: MemoryCalls;
let homeRoot: string;
let store: ReturnType<typeof createInMemoryDocumentStore>;

beforeEach(async () => {
  homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-admin-v1-"));
  store = createInMemoryDocumentStore();
  await store.set("facts", "fact-1", {
    ...SCOPE,
    content: "The migration needs legal approval.",
    createdAt: "2026-07-01T00:00:00.000Z",
    id: "fact-1",
    lifecycle: "active",
    updatedAt: "2026-07-01T00:00:00.000Z",
  });
  await store.set("facts", "fact-2", {
    ...SCOPE,
    content: "The migration needs a rollback plan.",
    createdAt: "2026-07-02T00:00:00.000Z",
    id: "fact-2",
    lifecycle: "active",
    updatedAt: "2026-07-02T00:00:00.000Z",
  });
  const built = buildMemory();
  calls = built.calls;
  app = createInspectorApp({
    documentStore: store,
    homeRoot,
    memory: built.memory,
    newRequestId: () => "request-test",
    token: TOKEN,
  });
});

afterEach(async () => {
  await rm(homeRoot, { force: true, recursive: true });
});

function adminRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  if (init.body) {
    headers.set("content-type", "application/json");
  }
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers,
    }),
  );
}

describe("Inspector Admin API v1", () => {
  it("requires Bearer auth and returns the versioned error envelope", async () => {
    const response = await app.fetch(
      new Request(`http://localhost/admin/v1/scopes?token=${TOKEN}`),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe("request-test");
    expect(await response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "A valid Bearer token is required.",
        requestId: "request-test",
      },
    });
  });

  it("serves the built SPA without putting its token in an HTTP request", async () => {
    const webRoot = join(homeRoot, "inspector-web");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(join(webRoot, "index.html"), "<!doctype html><div id=\"root\"></div>");
    await writeFile(join(webRoot, "assets", "app-123.js"), "console.log('app')");
    const staticApp = createInspectorApp({
      documentStore: store,
      memory: buildMemory().memory,
      token: TOKEN,
      webRoot,
    });

    const shell = await staticApp.fetch(new Request("http://localhost/scopes/example/memories"));
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("id=\"root\"");
    expect(shell.headers.get("content-security-policy")).not.toContain("unsafe-inline");

    const asset = await staticApp.fetch(new Request("http://localhost/assets/app-123.js"));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
  });

  it("supports a scope-bound read-only mode without mutation routes", async () => {
    const readOnly = createInspectorApp({
      allowedScopeKey: SCOPE_KEY,
      documentStore: store,
      homeRoot,
      memory: buildMemory().memory,
      newRequestId: () => "request-read-only",
      readOnly: true,
      token: TOKEN,
    });
    const descriptor = await readOnly.fetch(
      new Request("http://localhost/admin/v1/descriptor", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(await descriptor.json()).toEqual({
      data: {
        bindHost: "127.0.0.1",
        mutationRoutes: false,
        readOnly: true,
        tokenRequired: true,
      },
    });

    const blocked = await readOnly.fetch(
      new Request(
        `http://localhost/admin/v1/scopes/${encodeURIComponent(SCOPE_KEY)}/memories/fact-1`,
        {
          headers: { authorization: `Bearer ${TOKEN}` },
          method: "DELETE",
        },
      ),
    );
    expect(blocked.status).toBe(405);
    expect(await blocked.json()).toMatchObject({
      error: { code: "read_only", requestId: "request-read-only" },
    });
  });

  it("lists scopes and exact-scope memories with stable cursor pagination", async () => {
    const scopes = await adminRequest("/admin/v1/scopes");
    expect(scopes.status).toBe(200);
    expect(await scopes.json()).toMatchObject({
      data: {
        items: [
          {
            coverage: "partial",
            scopeKey: SCOPE_KEY,
            totalRecords: 2,
          },
        ],
      },
    });

    const first = await adminRequest(
      `/admin/v1/scopes/${encodeURIComponent(SCOPE_KEY)}/memories?limit=1`,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      data: { items: Array<{ etag: string; id: string }>; nextCursor: string };
    };
    expect(firstBody.data.items).toHaveLength(1);
    expect(firstBody.data.items[0]?.id).toBe("fact-1");
    expect(firstBody.data.items[0]?.etag).toMatch(/^"[a-f0-9]{64}"$/u);

    const second = await adminRequest(
      `/admin/v1/scopes/${encodeURIComponent(SCOPE_KEY)}/memories?limit=1&cursor=${encodeURIComponent(firstBody.data.nextCursor)}`,
    );
    expect(await second.json()).toMatchObject({
      data: { items: [{ id: "fact-2" }] },
    });
  });

  it("keeps superseded preference lineage visible in the Inspector", async () => {
    await store.set("preferences", "preference-old", {
      ...SCOPE,
      category: "general_preference",
      id: "preference-old",
      lifecycle: "superseded",
      supersededBy: "preference-new",
      updatedAt: "2026-07-01T00:00:00.000Z",
      value: "I prefer jasmine tea.",
    });
    await store.set("preferences", "preference-new", {
      ...SCOPE,
      category: "general_preference",
      id: "preference-new",
      lifecycle: "active",
      supersededBy: null,
      updatedAt: "2026-07-02T00:00:00.000Z",
      value: "I prefer dark editor themes.",
    });

    const response = await adminRequest(
      `/admin/v1/scopes/${encodeURIComponent(SCOPE_KEY)}/memories?collection=preferences`,
    );
    const body = (await response.json()) as {
      data: {
        items: Array<{
          id: string;
          lifecycle: string;
          revisable: boolean;
          supersededBy?: string | null;
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual([
      expect.objectContaining({
        id: "preference-new",
        lifecycle: "active",
        revisable: true,
        supersededBy: null,
      }),
      expect.objectContaining({
        id: "preference-old",
        lifecycle: "superseded",
        revisable: false,
        supersededBy: "preference-new",
      }),
    ]);
  });

  it("rejects malformed memory cursors as client errors", async () => {
    const response = await adminRequest(
      `/admin/v1/scopes/${encodeURIComponent(SCOPE_KEY)}/memories?cursor=not-a-cursor`,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_cursor");
  });

  it("lazily catalogs historical scopes and includes catalog-only scopes", async () => {
    const catalogOnlyScope = {
      tenantId: "tenant-2",
      userId: "catalog-only-user",
    };
    const catalogOnlyKey = scopeToKey(catalogOnlyScope);
    await store.set<ScopeCatalogProjection>(
      SCOPE_CATALOG_COLLECTION,
      `scope:${catalogOnlyKey}`,
      {
        ...catalogOnlyScope,
        analyzerFingerprint: null,
        coverage: "complete",
        firstSeenAt: "2026-07-03T00:00:00.000Z",
        id: `scope:${catalogOnlyKey}`,
        lastSeenAt: "2026-07-03T00:00:00.000Z",
        projectionVersion: RECALL_PROJECTION_PIPELINE_VERSION,
        schemaVersion: 2,
        searchSchemaVersion: PROJECTION_SEARCH_SCHEMA_VERSION,
        scopeKey: catalogOnlyKey,
      },
    );

    const response = await adminRequest("/admin/v1/scopes");
    const body = (await response.json()) as {
      data: {
        items: Array<{
          coverage: string;
          scopeKey: string;
          totalRecords: number;
        }>;
      };
    };
    expect(body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coverage: "partial",
          scopeKey: SCOPE_KEY,
          totalRecords: 2,
        }),
        expect.objectContaining({
          coverage: "complete",
          scopeKey: catalogOnlyKey,
          totalRecords: 0,
        }),
      ]),
    );
    expect(
      await store.get<ScopeCatalogProjection>(
        SCOPE_CATALOG_COLLECTION,
        `scope:${SCOPE_KEY}`,
      ),
    ).toMatchObject({ coverage: "partial", scopeKey: SCOPE_KEY });
    expect(
      await store.get(SCOPE_CATALOG_COLLECTION, "migration:durable-v1"),
    ).toMatchObject({ schemaVersion: 1 });
  });

  it("enforces ETags and replays an idempotent memory delete", async () => {
    const listed = await adminRequest(
      `/admin/v1/scopes/${encodeURIComponent(SCOPE_KEY)}/memories`,
    );
    const item = ((await listed.json()) as {
      data: { items: Array<{ etag: string; id: string }> };
    }).data.items.find(({ id }) => id === "fact-1")!;
    const path = `/admin/v1/scopes/${encodeURIComponent(SCOPE_KEY)}/memories/fact-1`;

    const conflict = await adminRequest(path, {
      headers: {
        "idempotency-key": "delete-fact-1-conflict",
        "if-match": '"stale"',
      },
      method: "DELETE",
    });
    expect(conflict.status).toBe(412);
    expect(calls.forget).toBe(0);

    const init = {
      headers: {
        "idempotency-key": "delete-fact-1",
        "if-match": item.etag,
      },
      method: "DELETE",
    } satisfies RequestInit;
    const deleted = await adminRequest(path, init);
    const replayed = await adminRequest(path, init);
    expect(deleted.status).toBe(200);
    expect(await replayed.json()).toEqual(await deleted.clone().json());
    expect(calls.forget).toBe(1);
  });

  it("creates an ETag-guarded idempotent revision", async () => {
    const listed = await adminRequest(
      `/admin/v1/scopes/${encodeURIComponent(SCOPE_KEY)}/memories`,
    );
    const item = ((await listed.json()) as {
      data: { items: Array<{ etag: string; id: string }> };
    }).data.items.find(({ id }) => id === "fact-2")!;
    const path = `/admin/v1/scopes/${encodeURIComponent(SCOPE_KEY)}/memories/fact-2/revisions`;
    const init = {
      body: JSON.stringify({
        content: "The migration needs a tested rollback plan.",
        reason: "manual_review",
      }),
      headers: {
        "idempotency-key": "revise-fact-2",
        "if-match": item.etag,
      },
      method: "POST",
    } satisfies RequestInit;

    const revised = await adminRequest(path, init);
    const replayed = await adminRequest(path, init);
    expect(revised.status).toBe(200);
    expect(await replayed.json()).toEqual(await revised.clone().json());
    expect(calls.revise).toBe(1);
  });

  it("returns a sanitized recall trace through POST", async () => {
    const response = await adminRequest("/admin/v1/recall-traces", {
      body: JSON.stringify({ query: "What blocks migration?", scopeKey: SCOPE_KEY }),
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        latencyMs: 3,
        policyApplied: ["admin_trace"],
      },
    });
    expect(calls.recall).toBe(1);
  });

  it("filters audit events to the requested exact scope", async () => {
    const otherScope = { userId: "other-user", workspaceId: "other-workspace" };
    await store.set("facts", "other-fact", {
      ...otherScope,
      content: "Other scope memory.",
      id: "other-fact",
    });
    await appendInspectorAuditEvent({
      homeRoot,
      event: {
        action: "forget",
        actionId: "scope-event",
        occurredAt: "2026-07-01T00:00:00.000Z",
        resultStatus: "ok",
        scopeDigest: buildWritebackScopeDigest(SCOPE),
        targetId: "fact-1",
      },
    });
    await appendInspectorAuditEvent({
      homeRoot,
      event: {
        action: "forget",
        actionId: "other-event",
        occurredAt: "2026-07-02T00:00:00.000Z",
        resultStatus: "ok",
        scopeDigest: buildWritebackScopeDigest(otherScope),
        targetId: "other-fact",
      },
    });

    const response = await adminRequest(
      `/admin/v1/audit-events?scopeKey=${encodeURIComponent(SCOPE_KEY)}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        items: [expect.objectContaining({ actionId: "scope-event" })],
      },
    });
  });

  it("enforces candidate transitions and can release an approved candidate", async () => {
    await persistReviewCandidates({
      candidates: [
        {
          candidateKey: "candidate-1",
          confidence: 0.9,
          content: "Prefers compact status summaries.",
          host: "codex",
          kind: "preference",
          reason: "explicit preference",
          scope: SCOPE,
          source: "user",
        },
      ],
      homeRoot,
      now: () => new Date("2026-07-11T00:00:00.000Z"),
    });
    const candidateId = buildReviewCandidateId({
      candidateKey: "candidate-1",
      scope: SCOPE,
    });
    const listed = await adminRequest(
      `/admin/v1/candidates?scopeKey=${encodeURIComponent(SCOPE_KEY)}`,
    );
    const pending = ((await listed.json()) as {
      data: { items: Array<{ etag: string; id: string; status: string }> };
    }).data.items[0]!;
    expect(pending).toMatchObject({ id: candidateId, status: "pending" });

    const approve = await adminRequest(
      `/admin/v1/candidates/${encodeURIComponent(candidateId)}`,
      {
        body: JSON.stringify({ scopeKey: SCOPE_KEY, status: "approved" }),
        headers: {
          "idempotency-key": "approve-candidate-1",
          "if-match": pending.etag,
        },
        method: "PATCH",
      },
    );
    expect(approve.status).toBe(200);
    expect(calls.remember).toBe(1);

    const approvedList = await adminRequest(
      `/admin/v1/candidates?scopeKey=${encodeURIComponent(SCOPE_KEY)}`,
    );
    const approved = ((await approvedList.json()) as {
      data: { items: Array<{ etag: string; status: string }> };
    }).data.items[0]!;
    expect(approved.status).toBe("approved");

    const released = await adminRequest(
      `/admin/v1/candidates/${encodeURIComponent(candidateId)}`,
      {
        body: JSON.stringify({ scopeKey: SCOPE_KEY, status: "released" }),
        headers: {
          "idempotency-key": "release-candidate-1",
          "if-match": approved.etag,
        },
        method: "PATCH",
      },
    );
    expect(released.status).toBe(200);
    expect(await released.json()).toMatchObject({
      data: { candidate: { status: "released" }, status: "released" },
    });
  });

  it("deletes an ETag-guarded scope and exposes the audit event", async () => {
    const scopes = await adminRequest("/admin/v1/scopes");
    const scope = ((await scopes.json()) as {
      data: { items: Array<{ etag: string; scopeKey: string }> };
    }).data.items[0]!;
    const response = await adminRequest(
      `/admin/v1/scopes/${encodeURIComponent(SCOPE_KEY)}`,
      {
        body: JSON.stringify({ cascadeAware: true, confirmScopeKey: SCOPE_KEY }),
        headers: {
          "idempotency-key": "delete-scope",
          "if-match": scope.etag,
        },
        method: "DELETE",
      },
    );
    expect(response.status).toBe(200);
    expect(calls.deleteAll).toBe(1);
    expect(
      await store.get(SCOPE_CATALOG_COLLECTION, `scope:${SCOPE_KEY}`),
    ).toBeNull();

    const audit = await adminRequest("/admin/v1/audit-events");
    expect(await audit.json()).toMatchObject({
      data: { items: [{ action: "delete-scope", resultStatus: "ok" }] },
    });
  });
});
