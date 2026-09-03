import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GoodMemory } from "../../src/api/contracts";
import type { MemoryScope } from "../../src/domain/scope";
import { scopeToKey } from "../../src/domain/scope";
import {
  createRuntimeViewerApp,
  createRuntimeViewerToken,
  normalizeRuntimeViewerBindHost,
  redactViewerText,
} from "../../src/runtime-viewer/public";
import { buildPageArtifacts } from "../../src/governance/pageArtifacts";

const TOKEN = "runtime-viewer-token";
const SCOPE: MemoryScope = {
  agentId: "codex",
  sessionId: "viewer-session",
  userId: "viewer-user",
  workspaceId: "viewer-workspace",
};
let homeRoot: string;
let webRoot: string;

beforeEach(async () => {
  homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-runtime-viewer-"));
  webRoot = join(homeRoot, "web");
  await mkdir(webRoot, { recursive: true });
  await writeFile(
    join(webRoot, "index.html"),
    "<!doctype html><title>GoodMemory Inspector</title><div id=\"root\"></div>",
  );
});

afterEach(async () => {
  await rm(homeRoot, { force: true, recursive: true });
});

function buildMemory(): Pick<GoodMemory, "exportMemory" | "recall"> {
  return {
    async exportMemory() {
      return {
        pages: buildPageArtifacts({ notes: [] }),
        artifacts: { files: [], rootPath: "." },
        durable: {
          archives: [],
          episodes: [],
          evidence: [],
          experiences: [],
          facts: [
            {
              category: "project",
              confidence: 1,
              content: "Runtime Viewer delegates to read-only Inspector.",
              createdAt: "2026-07-11T00:00:00.000Z",
              id: "viewer-fact",
              importance: 1,
              isActive: true,
              lifecycle: "active",
              source: {
                extractedAt: "2026-07-11T00:00:00.000Z",
                method: "explicit",
              },
              updatedAt: "2026-07-11T00:00:00.000Z",
              ...SCOPE,
            },
          ],
          feedback: [],
          preferences: [],
          profile: null,
          promotions: [],
          proposals: [],
          references: [],
        },
        exportedAt: "2026-07-11T00:00:00.000Z",
        runtime: { journal: null, spills: [], workingMemory: null },
        scope: SCOPE,
      } as Awaited<ReturnType<GoodMemory["exportMemory"]>>;
    },
    async recall() {
      return {
        archives: [],
        episodes: [],
        evidence: [],
        facts: [],
        feedback: [],
        journal: null,
        metadata: {
          candidateTraces: [],
          hits: [],
          latencyMs: 1,
          policyApplied: [],
          routingDecision: {},
          tokenCount: 0,
          verificationHints: [],
        },
        packet: {},
        preferences: [],
        profile: null,
        references: [],
        workingMemory: null,
      } as unknown as Awaited<ReturnType<GoodMemory["recall"]>>;
    },
  };
}

function createApp() {
  return createRuntimeViewerApp({
    memory: buildMemory(),
    scope: SCOPE,
    token: TOKEN,
    webRoot,
  });
}

describe("runtime viewer deprecation adapter", () => {
  it("keeps token generation and loopback validation", () => {
    expect(createRuntimeViewerToken()).toMatch(/^gmviewer_[A-Za-z0-9_-]+$/u);
    expect(normalizeRuntimeViewerBindHost(undefined)).toBe("127.0.0.1");
    expect(() => normalizeRuntimeViewerBindHost("0.0.0.0")).toThrow(
      "only binds 127.0.0.1",
    );
  });

  it("delegates its shell and data to a scope-bound read-only Inspector", async () => {
    const app = createApp();
    const shell = await app.fetch(new Request("http://localhost/"));
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("GoodMemory Inspector");

    const descriptor = await app.fetch(
      new Request("http://localhost/admin/v1/descriptor", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(await descriptor.json()).toMatchObject({
      data: { mutationRoutes: false, readOnly: true },
    });

    const scopes = await app.fetch(
      new Request("http://localhost/admin/v1/scopes", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(await scopes.json()).toMatchObject({
      data: { items: [{ scopeKey: scopeToKey(SCOPE) }] },
    });
  });

  it("does not accept query tokens and rejects every mutation", async () => {
    const app = createApp();
    const queryToken = await app.fetch(
      new Request(`http://localhost/admin/v1/scopes?token=${TOKEN}`),
    );
    expect(queryToken.status).toBe(401);

    const blocked = await app.fetch(
      new Request(
        `http://localhost/admin/v1/scopes/${encodeURIComponent(scopeToKey(SCOPE))}/memories/viewer-fact`,
        {
          headers: { authorization: `Bearer ${TOKEN}` },
          method: "DELETE",
        },
      ),
    );
    expect(blocked.status).toBe(405);
    expect(await blocked.json()).toMatchObject({ error: { code: "read_only" } });
  });

  it("keeps secret redaction available to historical callers", () => {
    expect(redactViewerText("token=secret-value a@example.com")).toBe(
      "[redacted-secret] [redacted-email]",
    );
  });

  it("redacts built-in language credential labels through LanguagePack analysis", () => {
    const credentials = [
      "비밀번호: bridge-secret",
      "mot de passe : bridge-secret",
      "contraseña: bridge-secret",
      "密码：bridge-secret",
      "密碼：bridge-secret",
      "パスワード：bridge-secret",
    ];

    for (const credential of credentials) {
      expect(redactViewerText(`${credential} owner@example.com`)).toBe(
        "[redacted-secret] [redacted-email]",
      );
    }
  });
});
