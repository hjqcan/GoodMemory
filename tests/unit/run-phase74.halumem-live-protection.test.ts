import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  runPhase74HaluMemLiveProtection,
  verifyPhase74HaluMemLiveRun,
} from "../../scripts/run-phase-74-halumem-live-protection";
import type {
  Phase74HaluMemLiveRunnerDependencies,
  Phase74HaluMemLiveRunnerOptions,
} from "../../scripts/run-phase-74-halumem-live-protection";
import type {
  Phase74HaluMemProtectionCliResult,
} from "../../scripts/run-phase-74-halumem-protection";
import type {
  Phase74HaluMemUser,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import { buildPhase74IngestionUsageFingerprint } from "../../src/eval/phase74FullRuntime";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "phase74-halumem-live-runner-"));
  roots.push(path);
  return path;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function user(uuid: string): Phase74HaluMemUser {
  return {
    persona_info: `${uuid} persona`,
    sessions: [{
      dialogue: [{
        content: `${uuid} works on Apollo.`,
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
      }],
      memory_points: [{
        importance: 1,
        is_update: "True",
        memory_content: `${uuid} now works on Mosaic.`,
        memory_source: "dialogue_turn=0",
        memory_type: "fact",
        original_memories: [`${uuid} worked on Apollo.`],
        timestamp: "2026-01-01T00:00:00.000Z",
      }],
      questions: [{
        answer: "Apollo",
        evidence: [{ memory_content: "works on Apollo" }],
        question: `Which project does ${uuid} work on?`,
      }],
      start_time: "2026-01-01T00:00:00.000Z",
    }],
    uuid,
  };
}

const users = [
  user("2f1f897e-d67f-dbc5-6a7b-b7634a9e294f"),
  user("10000000-0000-0000-0000-000000000001"),
  user("20000000-0000-0000-0000-000000000002"),
  user("30000000-0000-0000-0000-000000000003"),
];

function dataset(): string {
  return `${users.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

const models = {
  answer: {
    apiKey: "answer-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.6-terra",
    provider: "openai" as const,
  },
  assistedExtraction: {
    apiKey: "answer-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.6-terra",
    provider: "openai" as const,
  },
  embedding: {
    apiKey: "embedding-key",
    baseURL: "https://openrouter.ai/api/v1",
    model: "text-embedding-3-small",
    provider: "openai" as const,
  },
  judge: {
    apiKey: "judge-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.5",
    provider: "openai" as const,
  },
  planner: {
    apiKey: "answer-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.6-terra",
    provider: "openai" as const,
  },
  reranker: {
    apiKey: "answer-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.6-terra",
    provider: "openai" as const,
  },
};

async function fixtureOptions(
  mode: "live" | "preflight",
): Promise<Phase74HaluMemLiveRunnerOptions> {
  const directory = await root();
  const datasetPath = join(directory, "HaluMem-Medium.jsonl");
  const raw = dataset();
  await writeFile(datasetPath, raw, "utf8");
  return {
    datasetId: "HaluMem-Medium",
    datasetPath,
    embeddingSpendLimitUsd: 0.25,
    expectedDatasetSha256: sha256(raw),
    generatedAt: "2026-07-21T00:00:00.000Z",
    maxLanguageCalls: 1_000,
    mode,
    outputDir: join(directory, "runs"),
    replicate: 1,
    runId: `${mode}-run`,
    userCount: 2,
  };
}

function dependencies(
  counters: { createProviders: number; run: number },
): Phase74HaluMemLiveRunnerDependencies {
  return {
    async captureEvaluatorSource() {
      return { commit: "c".repeat(40), sha256: "e".repeat(64) };
    },
    createLiveDependencies() {
      counters.createProviders += 1;
      throw new Error("provider dependencies must not be created in preflight");
    },
    resolveModels() {
      return models;
    },
    async runProtection() {
      counters.run += 1;
      throw new Error("protection run must not execute in preflight");
    },
  };
}

async function frozenResult(runDirectory: string): Promise<Phase74HaluMemProtectionCliResult> {
  const write = async (relativePath: string) => {
    const path = join(runDirectory, relativePath);
    await Bun.write(path, `${JSON.stringify({ relativePath })}\n`);
    return path;
  };
  const e4ArtifactPath = await write("e4/protection-run.json");
  const e4RawPath = await write("e4/raw.json");
  const privacyArtifactPath = await write("privacy/protection-run.json");
  const privacyRawPath = await write("privacy/raw.json");
  const ingestionKey = "a".repeat(64);
  await Bun.write(
    join(runDirectory, "ingestion-usage", ingestionKey, "events.jsonl"),
    "",
  );
  await Bun.write(
    join(runDirectory, "ingestion-usage", ingestionKey, "intents.jsonl"),
    "",
  );
  await Bun.write(
    join(runDirectory, "ingestion", ingestionKey, "manifest.json"),
    `${JSON.stringify({
      key: ingestionKey,
      schemaVersion: 7,
      usage: buildPhase74IngestionUsageFingerprint({
        events: [],
        intents: [],
        pendingIntents: [],
      }),
    })}\n`,
  );
  return {
    e4: {
      artifact: {} as never,
      artifactPath: e4ArtifactPath,
      rawArtifactPath: e4RawPath,
    },
    privacy: {
      artifact: {} as never,
      artifactPath: privacyArtifactPath,
      rawArtifactPath: privacyRawPath,
    },
    update: {
      reason: "Pinned upstream HaluMem per-item update decisions are unavailable.",
      status: "not_evaluable",
    },
  };
}

describe("Phase 74 HaluMem live runner", () => {
  it("freezes an unseen structural selection and identity before a zero-provider preflight exits", async () => {
    const options = await fixtureOptions("preflight");
    const counters = { createProviders: 0, run: 0 };
    const result = await runPhase74HaluMemLiveProtection(
      options,
      dependencies(counters),
    );

    expect(result.status).toBe("preflight_complete");
    expect(counters).toEqual({ createProviders: 0, run: 0 });
    const selection = JSON.parse(await readFile(
      join(result.runDirectory, "selection-manifest.json"),
      "utf8",
    ));
    expect(selection.selectedUserUuids).toHaveLength(2);
    expect(selection.selectedUserUuids).not.toContain(
      "2f1f897e-d67f-dbc5-6a7b-b7634a9e294f",
    );
    const identityRaw = await readFile(
      join(result.runDirectory, "run-identity.json"),
      "utf8",
    );
    expect(identityRaw).not.toContain("answer-key");
    expect(JSON.parse(identityRaw).configuration.caseConcurrency).toBe(16);
    expect(Bun.file(join(result.runDirectory, "run-completion.json")).size)
      .toBe(0);

    await expect(runPhase74HaluMemLiveProtection(
      options,
      dependencies(counters),
    )).rejects.toThrow(/exist|create-only/iu);
    expect(counters).toEqual({ createProviders: 0, run: 0 });
  });

  it("creates providers only after identity, writes usage ledgers, and binds completion hashes", async () => {
    const options = await fixtureOptions("live");
    let identityExistedBeforeProviders = false;
    const result = await runPhase74HaluMemLiveProtection(options, {
      async captureEvaluatorSource() {
        return { commit: "c".repeat(40), sha256: "e".repeat(64) };
      },
      createLiveDependencies({ runDirectory }) {
        identityExistedBeforeProviders =
          Bun.file(join(runDirectory, "run-identity.json")).size > 0 &&
          Bun.file(join(runDirectory, "selection-manifest.json")).size > 0;
        return {
          e4: {} as never,
          privacy: {} as never,
        };
      },
      resolveModels() {
        return models;
      },
      async runProtection(cliOptions) {
        return frozenResult(join(cliOptions.outputDir, cliOptions.runId));
      },
    });

    expect(identityExistedBeforeProviders).toBe(true);
    expect(result.status).toBe("completed");
    expect(await readFile(
      join(result.runDirectory, "model-usage-intents.jsonl"),
      "utf8",
    )).toBe("");
    expect(await readFile(
      join(result.runDirectory, "model-usage.jsonl"),
      "utf8",
    )).toBe("");
    const completion = await verifyPhase74HaluMemLiveRun(result.runDirectory);
    expect(completion.updateStatus).toBe("not_evaluable");
    expect(completion.usage.ingestionKeyCount).toBe(1);
    expect(Object.keys(completion.artifacts)).toContain("e4/raw.json");
    expect(Object.keys(completion.artifacts)).toContain(
      `ingestion-usage/${"a".repeat(64)}/events.jsonl`,
    );
    expect(Object.keys(completion.artifacts)).toContain(
      `ingestion/${"a".repeat(64)}/manifest.json`,
    );
    expect(await readFile(
      join(result.runDirectory, "model-usage-summary.json"),
      "utf8",
    )).not.toContain(result.runDirectory);
    expect(Object.keys(completion.artifacts)).toContain("privacy/raw.json");
  });

  it("verify-only replays hashes without resolving models or creating providers", async () => {
    const options = await fixtureOptions("live");
    const live = await runPhase74HaluMemLiveProtection(options, {
      async captureEvaluatorSource() {
        return { commit: "c".repeat(40), sha256: "e".repeat(64) };
      },
      createLiveDependencies() {
        return { e4: {} as never, privacy: {} as never };
      },
      resolveModels() {
        return models;
      },
      async runProtection(cliOptions) {
        return frozenResult(join(cliOptions.outputDir, cliOptions.runId));
      },
    });
    const result = await runPhase74HaluMemLiveProtection({
      mode: "verify",
      runDirectory: live.runDirectory,
    }, {
      async captureEvaluatorSource() {
        throw new Error("verify-only must not capture source");
      },
      createLiveDependencies() {
        throw new Error("verify-only must not create providers");
      },
      resolveModels() {
        throw new Error("verify-only must not resolve models");
      },
      async runProtection() {
        throw new Error("verify-only must not run protection");
      },
    });

    expect(result.status).toBe("verified");
  });
});
