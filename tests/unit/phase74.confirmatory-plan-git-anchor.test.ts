import { describe, expect, it } from "bun:test";

import {
  verifyPhase74ConfirmatoryPlanGitAnchor,
  verifyRecordedPhase74ConfirmatoryPlanGitAnchor,
} from "../../scripts/phase-74-confirmatory-plan-anchor";
import type {
  Phase74ConfirmatoryPlanGitAnchorDependencies,
} from "../../scripts/phase-74-confirmatory-plan-anchor";

const ANCHOR_COMMIT = "a".repeat(40);
const HEAD_COMMIT = "b".repeat(40);
const PLAN_CONTENT = "{\n  \"artifactKind\": \"phase74-full-family-confirmatory-plan\"\n}\n";

function dependencies(
  overrides: Partial<Phase74ConfirmatoryPlanGitAnchorDependencies> = {},
): Phase74ConfirmatoryPlanGitAnchorDependencies {
  return {
    isAncestor: async () => true,
    readGitBlob: async () => PLAN_CONTENT,
    resolveGitHead: async () => HEAD_COMMIT,
    resolvePlanCommit: async () => ANCHOR_COMMIT,
    resolveRemoteRef: async () => ANCHOR_COMMIT,
    ...overrides,
  };
}

describe("Phase 74 confirmatory-plan Git anchor", () => {
  it("admits only a byte-exact tracked plan with a pre-run origin/main receipt", async () => {
    let remoteTarget = "";
    await expect(verifyPhase74ConfirmatoryPlanGitAnchor({
      dependencies: dependencies({
        resolveRemoteRef: async (_repoRoot, target) => {
          remoteTarget = target;
          return ANCHOR_COMMIT;
        },
      }),
      planContent: PLAN_CONTENT,
      planPath: "/repo/reports/quality-gates/phase-74/confirmatory-plan.json",
      repoRoot: "/repo",
    })).resolves.toEqual({
      commit: ANCHOR_COMMIT,
      executionCommit: HEAD_COMMIT,
      path: "reports/quality-gates/phase-74/confirmatory-plan.json",
      remote: "origin",
      remoteRef: "refs/heads/main",
      remoteUrl: "https://github.com/hjqcan/GoodMemory.git",
    });
    expect(remoteTarget).toBe(
      "https://github.com/hjqcan/GoodMemory.git",
    );
  });

  it("rejects plans outside the repository and plans absent from Git history", async () => {
    await expect(verifyPhase74ConfirmatoryPlanGitAnchor({
      dependencies: dependencies(),
      planContent: PLAN_CONTENT,
      planPath: "/tmp/confirmatory-plan.json",
      repoRoot: "/repo",
    })).rejects.toThrow(/inside.*repository|outside.*repository/i);

    await expect(verifyPhase74ConfirmatoryPlanGitAnchor({
      dependencies: dependencies({
        resolvePlanCommit: async () => "",
      }),
      planContent: PLAN_CONTENT,
      planPath: "/repo/confirmatory-plan.json",
      repoRoot: "/repo",
    })).rejects.toThrow(/tracked|commit|git/i);
  });

  it("rejects working-tree, HEAD-blob, ancestry, and remote-receipt drift", async () => {
    await expect(verifyPhase74ConfirmatoryPlanGitAnchor({
      dependencies: dependencies({
        readGitBlob: async (_repoRoot, revision) =>
          revision === HEAD_COMMIT ? "{}\n" : PLAN_CONTENT,
      }),
      planContent: PLAN_CONTENT,
      planPath: "/repo/confirmatory-plan.json",
      repoRoot: "/repo",
    })).rejects.toThrow(/byte|blob|drift/i);

    await expect(verifyPhase74ConfirmatoryPlanGitAnchor({
      dependencies: dependencies({
        isAncestor: async () => false,
      }),
      planContent: PLAN_CONTENT,
      planPath: "/repo/confirmatory-plan.json",
      repoRoot: "/repo",
    })).rejects.toThrow(/ancestor|history/i);

    await expect(verifyPhase74ConfirmatoryPlanGitAnchor({
      dependencies: dependencies({
        resolveRemoteRef: async () => "c".repeat(40),
      }),
      planContent: PLAN_CONTENT,
      planPath: "/repo/confirmatory-plan.json",
      repoRoot: "/repo",
    })).rejects.toThrow(/origin\/main|remote.*receipt/i);
  });

  it("replays the recorded execution commit instead of substituting aggregator HEAD", async () => {
    const revisions: string[] = [];
    await expect(verifyRecordedPhase74ConfirmatoryPlanGitAnchor({
      anchor: {
        commit: ANCHOR_COMMIT,
        executionCommit: HEAD_COMMIT,
        path: "reports/quality-gates/phase-74/confirmatory-plan.json",
        remote: "origin",
        remoteRef: "refs/heads/main",
        remoteUrl: "https://github.com/hjqcan/GoodMemory.git",
      },
      dependencies: dependencies({
        readGitBlob: async (_repoRoot, revision) => {
          revisions.push(revision);
          return PLAN_CONTENT;
        },
        resolveGitHead: async () => "c".repeat(40),
      }),
      planContent: PLAN_CONTENT,
      repoRoot: "/repo",
    })).resolves.toMatchObject({
      commit: ANCHOR_COMMIT,
      executionCommit: HEAD_COMMIT,
    });
    expect(revisions).toEqual([HEAD_COMMIT, ANCHOR_COMMIT]);
  });

  it("rejects a recorded anchor absent from the fixed GitHub remote history", async () => {
    const remoteCommit = "c".repeat(40);
    let remoteTarget = "";
    await expect(verifyRecordedPhase74ConfirmatoryPlanGitAnchor({
      anchor: {
        commit: ANCHOR_COMMIT,
        executionCommit: HEAD_COMMIT,
        path: "reports/quality-gates/phase-74/confirmatory-plan.json",
        remote: "origin",
        remoteRef: "refs/heads/main",
        remoteUrl: "https://github.com/hjqcan/GoodMemory.git",
      },
      dependencies: dependencies({
        isAncestor: async (_repoRoot, _ancestor, descendant) =>
          descendant !== remoteCommit,
        resolveRemoteRef: async (_repoRoot, target) => {
          remoteTarget = target;
          return remoteCommit;
        },
      }),
      planContent: PLAN_CONTENT,
      repoRoot: "/repo",
    })).rejects.toThrow(/remote.*history/i);
    expect(remoteTarget).toBe(
      "https://github.com/hjqcan/GoodMemory.git",
    );
  });
});
