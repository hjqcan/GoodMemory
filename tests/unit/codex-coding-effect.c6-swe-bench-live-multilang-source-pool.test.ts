import { describe, expect, it } from "bun:test";

import {
  buildC6SWEbenchLiveMultiLangSourcePoolSnapshot,
} from "../../scripts/codex-coding-effect/c6-swe-bench-live-multilang-source-pool";

const SPLIT_COUNTS = {
  c: 37,
  cpp: 74,
  go: 138,
  js: 93,
  rust: 94,
  java: 109,
  ts: 111,
  cs: 87,
} as const;

describe("Codex coding-effect C6 SWE-bench-Live MultiLang source pool", () => {
  it("freezes every row in preregistered split order without outcome selection", () => {
    const rowsBySplit = fixture();
    const snapshot =
      buildC6SWEbenchLiveMultiLangSourcePoolSnapshot(rowsBySplit);

    expect(snapshot.counts).toEqual({
      observedRows: 743,
      repositories: 743,
      splits: 8,
    });
    expect(snapshot.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "source-pool-only-graphql-capture-required",
    });
    expect(snapshot.rows[0]).toMatchObject({
      instanceId: "c-owner-0__repo-1",
      pullNumber: 1,
      rowIndex: 0,
      sourceSplit: "c",
      sourceSplitRowIndex: 0,
    });
    expect(snapshot.rows[37]).toMatchObject({
      instanceId: "cpp-owner-0__repo-1",
      pullNumber: 1,
      rowIndex: 37,
      sourceSplit: "cpp",
      sourceSplitRowIndex: 0,
    });
    expect(snapshot.rows.at(-1)).toMatchObject({
      rowIndex: 742,
      sourceSplit: "cs",
      sourceSplitRowIndex: 86,
    });
    expect(snapshot.independenceBoundary).toMatchObject({
      evaluatorFieldSelectionInput: false,
      machineOutcomeInput: false,
      selection: "all-frozen-source-rows",
      semanticLedgerInput: false,
    });
  });

  it("keeps capture targets invariant to evaluator-only mutations", () => {
    const baseline = buildC6SWEbenchLiveMultiLangSourcePoolSnapshot(
      fixture(),
    );
    const mutatedRows = fixture();
    mutatedRows.c[0]!.patch = "different hidden gold";
    mutatedRows.c[0]!.test_patch = "different hidden tests";
    mutatedRows.c[0]!.FAIL_TO_PASS = ["different failure"];
    const mutated = buildC6SWEbenchLiveMultiLangSourcePoolSnapshot(
      mutatedRows,
    );

    expect(
      mutated.independenceBoundary.captureTargetProjectionSha256,
    ).toBe(
      baseline.independenceBoundary.captureTargetProjectionSha256,
    );
    expect(mutated.rows[0]!.evaluatorOnlySha256).not.toBe(
      baseline.rows[0]!.evaluatorOnlySha256,
    );
  });

  it("rejects duplicate pull and instance identities", () => {
    const duplicate = fixture();
    duplicate.cpp[0]!.repo = duplicate.c[0]!.repo;
    duplicate.cpp[0]!.pull_number = duplicate.c[0]!.pull_number;
    duplicate.cpp[0]!.instance_id = duplicate.c[0]!.instance_id;
    expect(() =>
      buildC6SWEbenchLiveMultiLangSourcePoolSnapshot(duplicate)
    ).toThrow("duplicate source identity");
  });
});

function fixture(): Record<
  keyof typeof SPLIT_COUNTS,
  Array<ReturnType<typeof row>>
> {
  return Object.fromEntries(
    Object.entries(SPLIT_COUNTS).map(([split, count]) => [
      split,
      Array.from({ length: count }, (_, index) =>
        row(split, index)
      ),
    ]),
  ) as ReturnType<typeof fixture>;
}

function row(split: string, index: number) {
  const owner = `${split}-owner-${index}`;
  const repo = "repo";
  const pullNumber = index + 1;
  return {
    all_hints_text: "",
    base_commit: String((index % 9) + 1).repeat(40),
    commit_url:
      `https://github.com/${owner}/${repo}/commit/${String(index)}`,
    commit_urls: [],
    created_at: "2026-01-01T00:00:00Z",
    docker_image: "example/image:latest",
    FAIL_TO_PASS: ["fails"],
    hints_text: "",
    instance_id: `${owner}__${repo}-${pullNumber}`,
    issue_numbers: [String(pullNumber + 1000)],
    log_parser: "parser",
    PASS_TO_PASS: ["passes"],
    patch: "gold patch",
    print_cmds: ["print"],
    problem_statement: `Fix ${split} ${index}`,
    pull_number: String(pullNumber),
    rebuild_cmds: ["build"],
    repo: `${owner}/${repo}`,
    test_cmds: ["test"],
    test_patch: "hidden test patch",
  };
}
