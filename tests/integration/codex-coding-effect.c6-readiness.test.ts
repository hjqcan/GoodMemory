import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  computeC6AgentVisibleTaskContentSha256,
  loadC6C5Prerequisite,
} from "../../scripts/codex-coding-effect/c6-readiness";
import type {
  CodexCodingEffectDatasetV3,
} from "../../scripts/codex-coding-effect/dataset";

const C5_EVIDENCE_ROOT = resolve(
  "reports/quality-gates/phase-73/c5-native-longitudinal-pilot-v16",
);

describe("Codex coding-effect C6 readiness", () => {
  it("hashes only agent-visible repository, snapshot, prompt, history, and feedback input", () => {
    const episode = taskHashEpisode();
    const input = {
      episode,
      promptSha256ByPath: {
        "prompts/stage-1.md": "b".repeat(64),
        "prompts/stage-2.md": "c".repeat(64),
      },
      repositoryContentSha256: "d".repeat(64),
    };
    const baseline = computeC6AgentVisibleTaskContentSha256(input);
    const evaluatorOnly = structuredClone(episode);
    evaluatorOnly.forbiddenLeakage.strings = ["different evaluator sentinel"];
    evaluatorOnly.stages[0]!.expectedChangedFiles = ["src/hidden-only.ts"];
    evaluatorOnly.stages[0]!.goldPatch = {
      path: "evaluator/different.patch",
      sha256: "e".repeat(64),
    };
    evaluatorOnly.stages[0]!.hiddenFailToPass = ["different", "hidden"];
    evaluatorOnly.stages[0]!.hiddenPassToPass = ["different", "protection"];
    evaluatorOnly.stages[0]!.memoryExpectation = {
      dependencies: [],
      mode: "none",
    };
    expect(computeC6AgentVisibleTaskContentSha256({
      ...input,
      episode: evaluatorOnly,
    })).toBe(baseline);

    const repositoryIdentity = structuredClone(episode);
    repositoryIdentity.repository.url =
      "https://example.invalid/another-repository.git";
    const history = structuredClone(episode);
    history.stages[0]!.history.sha256 = "f".repeat(64);
    const feedback = structuredClone(episode);
    feedback.stages[0]!.allowedFeedback = [
      "The prior attempt failed because the public API name was wrong.",
    ];
    const snapshot = structuredClone(episode);
    snapshot.stages[0]!.snapshot = "9".repeat(40);

    for (const mutation of [
      {
        ...input,
        episode: repositoryIdentity,
      },
      {
        ...input,
        repositoryContentSha256: "0".repeat(64),
      },
      {
        ...input,
        promptSha256ByPath: {
          ...input.promptSha256ByPath,
          "prompts/stage-1.md": "1".repeat(64),
        },
      },
      {
        ...input,
        episode: history,
      },
      {
        ...input,
        episode: feedback,
      },
      {
        ...input,
        episode: snapshot,
      },
    ]) {
      expect(computeC6AgentVisibleTaskContentSha256(mutation))
        .not.toBe(baseline);
    }

    expect(() => computeC6AgentVisibleTaskContentSha256({
      ...input,
      promptSha256ByPath: {
        "prompts/stage-1.md": "b".repeat(64),
      },
    })).toThrow(
      "C6 agent-visible task prompt prompts/stage-2.md must bind a lowercase SHA-256",
    );
    expect(() => computeC6AgentVisibleTaskContentSha256({
      ...input,
      repositoryContentSha256: "D".repeat(64),
    })).toThrow(
      "C6 agent-visible task repository content must bind a lowercase SHA-256",
    );
  });

  it("cross-binds the accepted tracked C5 prerequisite without treating it as clean", async () => {
    const prerequisite = await loadC6C5Prerequisite(C5_EVIDENCE_ROOT);

    expect(prerequisite).toMatchObject({
      c5ReportedRequiredEpisodes: 113,
      externalAuthenticityVerified: false,
      gateSha256:
        "16a7864adbf5c496d004f8b484ece89242cbe92438a84dfee2e0c06ab806380c",
      headlineDesignEffect: 6,
      headlineMinimumPosition: 2,
      headlineObservationsPerEpisode: 6,
      incomparablePairs: 6,
      infrastructureFailureCount: 6,
      independentReviewSha256:
        "bd19614ab8b8034c4cd3fe0db97073765153199a4e0511b0c01b76addef7e5d8",
      planningMaterialEffectRate: 0.1,
      provenanceSha256:
        "0099cffd09defd0204602a4d1d96d693aa6913cbe20ae517e0aa9539d81c0d66",
      reportSha256:
        "5985be5969750286ef2d2af623741e12051d3830f96bd4b8e0907b849b1eab0b",
      requiredEpisodes: 391,
      requiredRepositories: 6,
      requiredScoredStages: 1_173,
      runId: "run-c5-pilot-v16-20260721T150112Z",
      verificationSha256:
        "de8aea82bb832d406256877d902f068037c6e9fb3e1a3530ae24480744d28af8",
    });
  });

  it("rejects a semantically mutated C5 report even when every file is readable", async () => {
    const root = await mkdtemp(join(
      await realpath(tmpdir()),
      "goodmemory-c6-c5-mutated-",
    ));
    try {
      await cp(C5_EVIDENCE_ROOT, root, { recursive: true });
      const reportPath = join(root, "report.json");
      const report = JSON.parse(await readFile(reportPath, "utf8")) as {
        fullSetBudget: { episodes: number };
      };
      report.fullSetBudget.episodes = 112;
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      await expect(loadC6C5Prerequisite(root)).rejects.toThrow(
        "C6 C5 prerequisite",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a self-consistent replacement for the accepted tracked C5 bundle", async () => {
    const root = await mkdtemp(join(
      await realpath(tmpdir()),
      "goodmemory-c6-c5-forged-",
    ));
    try {
      await cp(C5_EVIDENCE_ROOT, root, { recursive: true });
      const reportPath = join(root, "report.json");
      const report = JSON.parse(await readFile(reportPath, "utf8")) as {
        internalNote?: string;
      };
      report.internalNote = "forged but internally consistent";
      const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
      await writeFile(reportPath, reportBytes);

      const reviewPath = join(root, "independent-review.json");
      const review = JSON.parse(await readFile(reviewPath, "utf8")) as {
        reportSha256: string;
      };
      review.reportSha256 = sha256(reportBytes);
      const reviewBytes = `${JSON.stringify(review, null, 2)}\n`;
      await writeFile(reviewPath, reviewBytes);

      const provenancePath = join(root, "provenance.json");
      const provenance = JSON.parse(await readFile(provenancePath, "utf8")) as {
        response: {
          byteLength: number;
          sha256: string;
        };
      };
      provenance.response = {
        byteLength: Buffer.byteLength(reviewBytes),
        sha256: sha256(reviewBytes),
      };
      const provenanceBytes = `${JSON.stringify(provenance, null, 2)}\n`;
      await writeFile(provenancePath, provenanceBytes);

      const gatePath = join(root, "c5-gate.json");
      const gate = JSON.parse(await readFile(gatePath, "utf8")) as {
        independentReviewSha256: string;
        reviewProvenanceSha256: string;
      };
      gate.independentReviewSha256 = sha256(reviewBytes);
      gate.reviewProvenanceSha256 = sha256(provenanceBytes);
      await writeFile(gatePath, `${JSON.stringify(gate, null, 2)}\n`);

      await expect(loadC6C5Prerequisite(root)).rejects.toThrow(
        "accepted tracked C5 v16",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects symlinked C5 prerequisite files", async () => {
    const root = await mkdtemp(join(
      await realpath(tmpdir()),
      "goodmemory-c6-c5-symlink-",
    ));
    try {
      await cp(C5_EVIDENCE_ROOT, root, { recursive: true });
      const reportPath = join(root, "report.json");
      await rm(reportPath);
      await symlink(join(C5_EVIDENCE_ROOT, "report.json"), reportPath);

      await expect(loadC6C5Prerequisite(root)).rejects.toThrow(
        "C6 C5 report rejects symlink",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function taskHashEpisode():
  CodexCodingEffectDatasetV3["episodes"][number] {
  const stage = (
    id: string,
    position: number,
  ): CodexCodingEffectDatasetV3["episodes"][number]["stages"][number] => ({
    allowedFeedback: [],
    expectedChangedFiles: ["src/task.ts"],
    goldPatch: {
      path: `evaluator/${id}.patch`,
      sha256: "a".repeat(64),
    },
    hiddenFailToPass: ["bun", "test", "hidden"],
    hiddenPassToPass: ["bun", "test", "protection"],
    history: {
      forbiddenLeakageSha256: ["a".repeat(64)],
      path: "history/empty.jsonl",
      sha256: sha256(""),
      source: "frozen-artifact",
    },
    id,
    memoryExpectation: {
      dependencies: [],
      mode: "none",
    },
    position,
    promptPath: `prompts/${id}.md`,
    snapshot: String(position).repeat(40),
    timeoutMs: 1_000,
  });
  return {
    author: "fixture author",
    claimEligibility: "claim-eligible",
    ecosystem: "typescript",
    forbiddenLeakage: {
      fileSha256: ["a".repeat(64)],
      strings: ["hidden sentinel"],
    },
    historyPolicy: "stage-scoped-sealed-prefix-v1",
    id: "episode-one",
    language: "typescript",
    preparation: {
      command: ["true"],
      networkMode: "disabled",
    },
    provenance: "fixture provenance",
    repository: {
      assetPath: "repositories/repository-one",
      baseCommit: "a".repeat(40),
      license: "MIT",
      url: "https://example.invalid/repository.git",
    },
    sourceType: "controlled-mutation",
    stages: [
      stage("stage-1", 1),
      stage("stage-2", 2),
    ],
    stateMode: "canonical-snapshot",
    strata: ["no-history-negative-control"],
  };
}
