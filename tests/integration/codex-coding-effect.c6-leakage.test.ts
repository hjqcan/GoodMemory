import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  c4RepositoryIdForUrl,
} from "../../scripts/codex-coding-effect/c4-controlled-dataset";
import {
  auditC6CandidateStaticLeakage,
  auditC6FlatSummaryOutputLeakage,
} from "../../scripts/codex-coding-effect/c6-leakage";
import type {
  CodexCodingEffectDatasetV3,
} from "../../scripts/codex-coding-effect/dataset";
import {
  loadCodexCodingEffectDataset,
} from "../../scripts/codex-coding-effect/dataset";

const SOURCE_ROOT = "fixtures/codex-coding-effect/c4-controlled-pilot";
const SUMMARY_PROMPT = "Summarize only the supplied prior history.";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

describe("Codex coding-effect C6 leakage audit", () => {
  it("accepts clean candidate surfaces and one stage-scoped summary", async () => {
    const fixture = await loadFixture(SOURCE_ROOT);
    const stage = fixture.dataset.episodes[0]!.stages[0]!;

    const candidate = await auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: fixture.datasetManifestSha256,
      datasetRoot: SOURCE_ROOT,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    });
    const summary = await auditC6FlatSummaryOutputLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: fixture.datasetManifestSha256,
      datasetRoot: SOURCE_ROOT,
      episodeId: fixture.episodeId,
      output: "The prior discussion prefers explicit public validation.",
      stageId: stage.id,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    });

    expect(candidate).toMatchObject({
      assetRootSha256: sha256("asset-root"),
      datasetId: fixture.dataset.datasetId,
      datasetInputSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetManifestSha256: fixture.datasetManifestSha256,
      episodeCount: 1,
      schemaVersion: 2,
      stageCount: 3,
      status: "accepted",
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
      variant: "candidate-static",
    });
    expect(candidate.stageAudits.every((stage) =>
      stage.matrixAuditReceipt.fullMatrixAuditReceipt.overlapCount === 0 &&
      stage.matrixAuditReceipt.liveOverlapCount === 0 &&
      stage.matrixAuditReceipt.staticOverlapCount === 0
    )).toBe(true);
    expect(candidate.stageAudits.map((stage) => ({
      episodeId: stage.episodeId,
      futureHistorySuffixRecordCount:
        stage.futureHistorySuffixRecordCount,
      futureTargetPromptCount: stage.futureTargetPromptCount,
      historySourceSha256: stage.historySourceSha256,
      stageId: stage.stageId,
    }))).toEqual(fixture.dataset.episodes[0]!.stages.map((stage) => ({
      episodeId: fixture.episodeId,
      futureHistorySuffixRecordCount: 0,
      futureTargetPromptCount:
        fixture.dataset.episodes[0]!.stages.length - stage.position,
      historySourceSha256: stage.history.sha256,
      stageId: stage.id,
    })));
    expect(candidate.stageAudits.every((stage) =>
      /^[a-f0-9]{64}$/u.test(stage.futureVisibleClosureSha256)
    )).toBe(true);
    expect(summary).toMatchObject({
      assetRootSha256: sha256("asset-root"),
      datasetId: fixture.dataset.datasetId,
      datasetInputSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetManifestSha256: fixture.datasetManifestSha256,
      episodeId: fixture.episodeId,
      historySourceSha256: stage.history.sha256,
      outputSha256: sha256(
        "The prior discussion prefers explicit public validation.",
      ),
      schemaVersion: 2,
      stageId: stage.id,
      status: "accepted",
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
      variant: "flat-summary-output",
    });
    expect(summary.stageAudit).toMatchObject({
      futureHistorySuffixRecordCount: 0,
      futureTargetPromptCount: 2,
      historySourceSha256: stage.history.sha256,
      stageId: stage.id,
    });
    expect(summary.stageAudit.matrixAuditReceipt.liveOverlapCount).toBe(0);
  });

  it("audits empty history but forbids a no-history summary output", async () => {
    const root = await copyFixture();
    const fixture = await loadFixture(root);
    const episode = fixture.dataset.episodes[0]!;
    episode.primaryStratum = "no-history-negative-control";
    episode.strata = ["no-history-negative-control"];
    for (const stage of episode.stages) {
      await writeFile(join(root, stage.history.path), "");
      stage.history.sha256 = sha256("");
      stage.memoryExpectation = {
        dependencies: [],
        mode: "none",
      };
    }
    const context = {
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    };

    await expect(auditC6CandidateStaticLeakage(context)).resolves.toMatchObject({
      status: "accepted",
    });
    await expect(auditC6FlatSummaryOutputLeakage({
      ...context,
      episodeId: episode.id,
      output: "This provider output must never exist.",
      stageId: episode.stages[0]!.id,
    })).rejects.toThrow(
      "C6 no-history control forbids flat-summary provider output",
    );
  });

  it("binds each candidate stage to its own frozen history", async () => {
    const root = await copyFixture();
    const fixture = await loadFixture(root);
    const episode = fixture.dataset.episodes[0]!;
    const first = episode.stages[0]!;
    const second = episode.stages[1]!;
    const addedRecord =
      "The second stage receives one additional sealed historical record.";
    await extendStageHistory(
      root,
      episode.id,
      second,
      addedRecord,
    );
    episode.stages[2]!.history = structuredClone(second.history);

    const audit = await auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    });

    expect(first.history.sha256).not.toBe(second.history.sha256);
    expect(audit.stageAudits.map((stage) => stage.historySourceSha256)).toEqual(
      episode.stages.map((stage) => stage.history.sha256),
    );
    await expect(auditC6FlatSummaryOutputLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      episodeId: episode.id,
      output: `The established context says: ${addedRecord}`,
      stageId: second.id,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).resolves.toMatchObject({
      historySourceSha256: second.history.sha256,
      stageId: second.id,
      status: "accepted",
    });
  });

  it("rejects a future-stage prompt copied into an earlier-stage history", async () => {
    const root = await copyFixture();
    const fixture = await loadFixture(root);
    const episode = fixture.dataset.episodes[0]!;
    const futurePrompt = await readFile(
      join(root, episode.stages[1]!.promptPath),
      "utf8",
    );
    for (const stage of episode.stages) {
      await extendStageHistory(root, episode.id, stage, futurePrompt.trim());
    }

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("C6 candidate static leakage rejected");
  });

  it("rejects a future-stage prompt copied into an earlier-stage summary", async () => {
    const fixture = await loadFixture(SOURCE_ROOT);
    const episode = fixture.dataset.episodes[0]!;
    const futurePrompt = await readFile(
      join(SOURCE_ROOT, episode.stages[1]!.promptPath),
      "utf8",
    );

    await expect(auditC6FlatSummaryOutputLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: fixture.datasetManifestSha256,
      datasetRoot: SOURCE_ROOT,
      episodeId: episode.id,
      output: futurePrompt.trim(),
      stageId: episode.stages[0]!.id,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("C6 flat-summary output leakage rejected");
  });

  it("rejects a later history suffix copied into an earlier-stage summary", async () => {
    const root = await copyFixture();
    const fixture = await loadFixture(root);
    const episode = fixture.dataset.episodes[0]!;
    const futureRecord = "FUTURE_HISTORY_SUFFIX_ONLY_72941";
    await extendStageHistory(
      root,
      episode.id,
      episode.stages[1]!,
      futureRecord,
    );
    episode.stages[2]!.history = structuredClone(
      episode.stages[1]!.history,
    );

    await expect(auditC6FlatSummaryOutputLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      episodeId: episode.id,
      output: `The future record says ${futureRecord}.`,
      stageId: episode.stages[0]!.id,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("C6 flat-summary output leakage rejected");
  });

  it("fails closed when stage histories are not an exact record prefix", async () => {
    const root = await copyFixture();
    const fixture = await loadFixture(root);
    const episode = fixture.dataset.episodes[0]!;
    await replaceStageHistory(
      root,
      episode.id,
      episode.stages[1]!,
      "This record replaces rather than extends the earlier history.",
    );
    episode.stages[2]!.history = structuredClone(
      episode.stages[1]!.history,
    );

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("is not an exact record prefix");
  });

  it("rejects a later-stage gold fragment in an earlier-stage history", async () => {
    const root = await copyFixture();
    const fixture = await loadFixture(root);
    const episode = fixture.dataset.episodes[0]!;
    const secret = await goldFragment(root, episode.stages[2]!.goldPatch.path);
    for (const stage of episode.stages) {
      await extendStageHistory(root, episode.id, stage, secret);
    }

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("C6 candidate static leakage rejected");
  });

  it("rejects a gold implementation fragment in the summary prompt", async () => {
    const fixture = await loadFixture(SOURCE_ROOT);
    const secret = await goldFragment(
      SOURCE_ROOT,
      fixture.dataset.episodes[0]!.stages[0]!.goldPatch.path,
    );

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: fixture.datasetManifestSha256,
      datasetRoot: SOURCE_ROOT,
      summaryPrompt: `${SUMMARY_PROMPT}\n${secret}`,
      summaryPromptSha256: sha256(`${SUMMARY_PROMPT}\n${secret}`),
    })).rejects.toThrow("C6 candidate static leakage rejected");
  });

  it("rejects a later-stage gold fragment in an earlier-stage prompt", async () => {
    const root = await copyFixture();
    const fixture = await loadFixture(root);
    const episode = fixture.dataset.episodes[0]!;
    const secret = await goldFragment(root, episode.stages[1]!.goldPatch.path);
    await writeFile(
      join(root, episode.stages[0]!.promptPath),
      `Implement stage one.\n${secret}\n`,
    );

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("C6 candidate static leakage rejected");
  });

  it("rejects a gold implementation fragment in a generated summary", async () => {
    const fixture = await loadFixture(SOURCE_ROOT);
    const stage = fixture.dataset.episodes[0]!.stages[0]!;
    const secret = await goldFragment(
      SOURCE_ROOT,
      fixture.dataset.episodes[0]!.stages[2]!.goldPatch.path,
    );

    await expect(auditC6FlatSummaryOutputLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: fixture.datasetManifestSha256,
      datasetRoot: SOURCE_ROOT,
      episodeId: fixture.episodeId,
      output: `Prior context says to apply:\n${secret}`,
      stageId: stage.id,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("C6 flat-summary output leakage rejected");
  });

  it("rejects a dataset-declared forbidden string in the summary prompt", async () => {
    const fixture = await loadFixture(SOURCE_ROOT);
    const forbidden = "C6_DECLARED_FORBIDDEN_PROMPT_48291";
    fixture.dataset.episodes[0]!.forbiddenLeakage.strings = [forbidden];

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: SOURCE_ROOT,
      summaryPrompt: `${SUMMARY_PROMPT}\n${forbidden}`,
      summaryPromptSha256: sha256(`${SUMMARY_PROMPT}\n${forbidden}`),
    })).rejects.toThrow("C6 candidate static leakage rejected");
  });

  it("rejects a dataset-declared forbidden string in a generated summary", async () => {
    const fixture = await loadFixture(SOURCE_ROOT);
    const stage = fixture.dataset.episodes[0]!.stages[0]!;
    const forbidden = "C6_DECLARED_FORBIDDEN_SUMMARY_73910";
    fixture.dataset.episodes[0]!.forbiddenLeakage.strings = [forbidden];

    await expect(auditC6FlatSummaryOutputLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: SOURCE_ROOT,
      episodeId: fixture.episodeId,
      output: `Prior context contains ${forbidden}.`,
      stageId: stage.id,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("C6 flat-summary output leakage rejected");
  });

  it("loads every declared forbidden evaluator file into the leakage matrix", async () => {
    const root = await copyFixture();
    const fixture = await loadFixture(root);
    const secret = "C6_DECLARED_EVALUATOR_FILE_SECRET_91827";
    const secretPath = join(root, "evaluator", "declared-secret.txt");
    await writeFile(secretPath, `${secret}\n`);
    fixture.dataset.episodes[0]!.forbiddenLeakage.fileSha256.push(
      sha256(`${secret}\n`),
    );

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      summaryPrompt: `${SUMMARY_PROMPT}\n${secret}`,
      summaryPromptSha256: sha256(`${SUMMARY_PROMPT}\n${secret}`),
    })).rejects.toThrow("C6 candidate static leakage rejected");
  });

  it("rejects a declared forbidden evaluator file copied into the repository", async () => {
    const root = await copyFixture();
    const fixture = await loadFixture(root);
    const episode = fixture.dataset.episodes[0]!;
    const secret = "C6_DECLARED_REPOSITORY_SECRET_18426";
    await writeFile(
      join(root, "evaluator", "declared-repository-secret.txt"),
      `${secret}\n`,
    );
    episode.forbiddenLeakage.fileSha256.push(sha256(`${secret}\n`));
    await writeFile(
      join(root, episode.repository.assetPath!, "declared-secret.txt"),
      `${secret}\n`,
    );

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("C6 candidate static leakage rejected");
  });

  it("uses every stage's declared forbidden artifacts for the episode closure", async () => {
    const root = await copyFixture();
    const fixture = await loadFixture(root);
    const episode = fixture.dataset.episodes[0]!;
    const secret = "C6_LATER_STAGE_HISTORY_FORBIDDEN_62481";
    await writeFile(
      join(root, "evaluator", "later-stage-forbidden.txt"),
      `${secret}\n`,
    );
    episode.stages[2]!.history.forbiddenLeakageSha256.push(
      sha256(`${secret}\n`),
    );

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      summaryPrompt: `${SUMMARY_PROMPT}\n${secret}`,
      summaryPromptSha256: sha256(`${SUMMARY_PROMPT}\n${secret}`),
    })).rejects.toThrow("C6 candidate static leakage rejected");
    await expect(auditC6FlatSummaryOutputLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: root,
      episodeId: episode.id,
      output: `The stage summary contains ${secret}.`,
      stageId: episode.stages[0]!.id,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("C6 flat-summary output leakage rejected");
  });

  it("requires an existing stage identity for a summary audit", async () => {
    const fixture = await loadFixture(SOURCE_ROOT);
    const common = {
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: fixture.datasetManifestSha256,
      datasetRoot: SOURCE_ROOT,
      episodeId: fixture.episodeId,
      output: "A clean stage summary.",
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    };

    await expect(auditC6FlatSummaryOutputLeakage({
      ...common,
      stageId: "missing-stage",
    })).rejects.toThrow("has no stage missing-stage");
    await expect(auditC6FlatSummaryOutputLeakage({
      ...common,
      stageId: undefined as unknown as string,
    })).rejects.toThrow("requires a stageId");
  });

  it("rejects the superseded episode-level dataset contract", async () => {
    const loaded = await loadCodexCodingEffectDataset(SOURCE_ROOT);

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: loaded.dataset as unknown as CodexCodingEffectDatasetV3,
      datasetManifestSha256: loaded.manifestSha256,
      datasetRoot: SOURCE_ROOT,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("requires dataset schema version 3");
  });

  it("requires the C6 repository to resolve through its asset-locked path", async () => {
    const fixture = await loadFixture(SOURCE_ROOT);
    delete fixture.dataset.episodes[0]!.repository.assetPath;

    await expect(auditC6CandidateStaticLeakage({
      assetRootSha256: sha256("asset-root"),
      dataset: fixture.dataset,
      datasetManifestSha256: sha256(JSON.stringify(fixture.dataset)),
      datasetRoot: SOURCE_ROOT,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    })).rejects.toThrow("requires repository.assetPath");
  });
});

async function copyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-leakage-"));
  temporaryRoots.push(root);
  await cp(SOURCE_ROOT, root, { recursive: true });
  return root;
}

async function goldFragment(root: string, path: string): Promise<string> {
  const line = (await readFile(join(root, path), "utf8"))
    .split(/\r?\n/u)
    .find((candidate) =>
      candidate.startsWith("+") &&
      !candidate.startsWith("+++") &&
      candidate.slice(1).trim().length >= 8
    );
  if (line === undefined) {
    throw new Error(`test fixture gold patch has no semantic fragment: ${path}`);
  }
  return line.slice(1).trim();
}

async function loadFixture(root: string): Promise<{
  dataset: CodexCodingEffectDatasetV3;
  datasetManifestSha256: string;
  episodeId: string;
}> {
  const loaded = await loadCodexCodingEffectDataset(root);
  if (loaded.dataset.schemaVersion !== 2) {
    throw new Error("test fixture requires dataset schema version 2");
  }
  const sourceEpisode = loaded.dataset.episodes[0]!;
  if (sourceEpisode.prehistory.source !== "frozen-artifact") {
    throw new Error("test fixture requires frozen prehistory");
  }
  const prehistory = structuredClone(sourceEpisode.prehistory);
  const {
    prehistory: _prehistory,
    ...episodeWithoutHistory
  } = structuredClone(sourceEpisode);
  const episode: CodexCodingEffectDatasetV3["episodes"][number] = {
    ...episodeWithoutHistory,
    historyPolicy: "stage-scoped-sealed-prefix-v1",
    stages: episodeWithoutHistory.stages.map((stage) => ({
      ...stage,
      history: structuredClone(prehistory),
    })),
  };
  episode.repository.assetPath = `repositories/${
    c4RepositoryIdForUrl(episode.repository.url)
  }`;
  const dataset: CodexCodingEffectDatasetV3 = {
    datasetId: loaded.dataset.datasetId,
    episodes: [episode],
    schemaVersion: 3,
    ...(loaded.dataset.sourceLineage === undefined
      ? {}
      : { sourceLineage: loaded.dataset.sourceLineage }),
    ...(loaded.dataset.taskOriginReviewProvenance === undefined
      ? {}
      : {
          taskOriginReviewProvenance:
            loaded.dataset.taskOriginReviewProvenance,
        }),
  };
  return {
    dataset,
    datasetManifestSha256: sha256(JSON.stringify(dataset)),
    episodeId: episode.id,
  };
}

async function extendStageHistory(
  root: string,
  episodeId: string,
  stage: CodexCodingEffectDatasetV3["episodes"][number]["stages"][number],
  message: string,
): Promise<void> {
  const source = await readFile(join(root, stage.history.path), "utf8");
  const record = {
    payload: {
      content: [{ text: message, type: "input_text" }],
      role: "user",
      type: "message",
    },
    type: "response_item",
  };
  const history = `${source.trimEnd()}\n${JSON.stringify(record)}\n`;
  const path = `prehistory/${episodeId}-${stage.id}.jsonl`;
  await writeFile(join(root, path), history);
  stage.history.path = path;
  stage.history.sha256 = sha256(history);
}

async function replaceStageHistory(
  root: string,
  episodeId: string,
  stage: CodexCodingEffectDatasetV3["episodes"][number]["stages"][number],
  message: string,
): Promise<void> {
  const record = {
    payload: {
      content: [{ text: message, type: "input_text" }],
      role: "user",
      type: "message",
    },
    type: "response_item",
  };
  const history = `${JSON.stringify(record)}\n`;
  const path = `prehistory/${episodeId}-${stage.id}-replacement.jsonl`;
  await writeFile(join(root, path), history);
  stage.history.path = path;
  stage.history.sha256 = sha256(history);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
