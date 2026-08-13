import { SQL } from "bun";
import { describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GoodMemory } from "../../src/api/contracts";
import { createInternalGoodMemory } from "../../src/api/createGoodMemory";
import { recordBehavioralTrace } from "../../src/host/behavioralTraceBridge";
import { parseGoodMemoryRecordRef } from "../../src/progressive/recall";
import { createGoodMemoryRuntimeKit } from "../../src/runtime-kit";
import {
  createPostgresDocumentStore,
  createPostgresSessionStore,
  migratePostgresStorageBackend,
} from "../../src/storage/postgres";

const POSTGRES_URL = process.env.GOODMEMORY_TEST_POSTGRES_URL;
const SCOPE_DIGEST_SECRET = "raw-carryover-storage-test-secret";

async function expectStoredToolOutcomeBoundary(input: {
  createMemory(): GoodMemory;
  scope: { userId: string; workspaceId: string };
}): Promise<void> {
  const writer = input.createMemory();
  const trace = {
    cue: "Copy the report into backup.",
    events: [
      {
        actionKind: "tool_call" as const,
        actionName: "copy_file",
        outcome: "failure" as const,
        raw: "copy_file(old)",
        stepIndex: 0,
      },
      {
        actionKind: "tool_call" as const,
        actionName: "copy_file",
        correctionOfStepIndex: 0,
        outcome: "success" as const,
        raw: "copy_file(safe)",
        stepIndex: 1,
      },
    ],
    hostKind: "codex" as const,
    traceId: "stored-raw-carryover-trace",
  };
  const first = await recordBehavioralTrace({
    memory: writer,
    scope: input.scope,
    trace,
  });
  const retried = await recordBehavioralTrace({
    memory: writer,
    scope: input.scope,
    trace,
  });
  expect(first.recorded).toBe(true);
  expect(retried.recorded).toBe(true);

  const reader = input.createMemory();
  const exported = await reader.exportMemory({ scope: input.scope });
  const experiences = exported.durable.experiences.filter(
    (record) => record.kind === "tool_outcome",
  );
  expect(experiences).toHaveLength(1);
  const experience = experiences[0];
  expect(experience).toBeDefined();

  const runtimeKit = createGoodMemoryRuntimeKit({
    memory: reader,
    scopeDigestSecret: SCOPE_DIGEST_SECRET,
  });
  const matching = await runtimeKit.beforeModelCall({
    query: "Copy the report into backup.",
    retrievalProfile: "coding_agent",
    scope: input.scope,
  });
  const mismatch = await runtimeKit.beforeModelCall({
    query: "Copy the report into backup.",
    retrievalProfile: "general_chat",
    scope: input.scope,
  });

  expect(matching.context.content).toContain("copy_file(safe)");
  expect(matching.context.recordRefs).toHaveLength(1);
  expect(parseGoodMemoryRecordRef(matching.context.recordRefs![0]!)).toMatchObject({
    id: experience!.id,
    recordKind: "experience",
  });
  expect(mismatch.context.content).not.toContain("copy_file(safe)");
  expect(mismatch.context.recordRefs).toBeUndefined();
}

describe("stored raw carryover profile boundary", () => {
  it("persists and enforces exact tool-outcome profiles in SQLite", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-raw-carryover-${Date.now()}-${Math.random()}.sqlite`,
    );
    const scope = {
      userId: "sqlite-raw-carryover-user",
      workspaceId: "sqlite-raw-carryover-workspace",
    };

    try {
      await expectStoredToolOutcomeBoundary({
        createMemory: () => createInternalGoodMemory(
          { storage: { provider: "sqlite", url: path } },
          { behavioralOutcomeRecorder: true },
        ),
        scope,
      });
    } finally {
      await Promise.all([
        rm(path, { force: true }),
        rm(`${path}-shm`, { force: true }),
        rm(`${path}-wal`, { force: true }),
      ]);
    }
  });

  const postgresIt = POSTGRES_URL ? it : it.skip;
  postgresIt("persists and enforces exact tool-outcome profiles in PostgreSQL", async () => {
    const schema = `gm_raw_carryover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const storage = { schema, url: POSTGRES_URL! };
    const sql = new SQL(POSTGRES_URL!);

    try {
      await migratePostgresStorageBackend(storage, { log: () => {} });
      const adapters = {
        documentStore: createPostgresDocumentStore(storage),
        sessionStore: createPostgresSessionStore(storage),
      };
      await expectStoredToolOutcomeBoundary({
        createMemory: () => createInternalGoodMemory(
          { adapters },
          { behavioralOutcomeRecorder: true },
        ),
        scope: {
          userId: "postgres-raw-carryover-user",
          workspaceId: "postgres-raw-carryover-workspace",
        },
      });
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.close();
    }
  }, 30_000);
});
