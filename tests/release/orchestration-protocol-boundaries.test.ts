import { describe, expect, it } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const REPOSITORY_ROOT = join(import.meta.dir, "../..");

function publicationAllowed(input: {
  eventName: string;
  manifestStatus: string;
  ref: string;
  refName: string;
  version: string;
}): boolean {
  return input.eventName === "push" &&
    input.ref.startsWith("refs/tags/") &&
    input.manifestStatus === "stable" &&
    input.refName === `v${input.version}`;
}

function collectBunRunTargets(content: string): string[] {
  return [...content.matchAll(/\bbun run ([A-Za-z0-9:._/-]+)/gu)]
    .map((match) => match[1]!);
}

describe("orchestration and proof protocol boundaries", () => {
  it("keeps the plugin scanner workflow read-only and source-pinned", async () => {
    const workflow = await readFile(
      join(REPOSITORY_ROOT, ".github/workflows/plugin-security-scan.yml"),
      "utf8",
    );

    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain(
      "hashgraph-online/ai-plugin-scanner-action@55616c962cf86368423f7673b2ecdfdbe613d1af",
    );
    expect(workflow).toContain('plugin_dir: "."');
    expect(workflow).toContain("min_score: 80");
    expect(workflow).toContain("fail_on_severity: high");
    expect(workflow).not.toContain("online: true");
    expect(workflow).not.toContain("submission_enabled: true");
    expect(workflow).not.toContain("secrets.");
  });

  it("fetches the history required by source-bound unit tests", async () => {
    const workflow = await readFile(
      join(REPOSITORY_ROOT, ".github/workflows/ci.yml"),
      "utf8",
    );
    const testJob = workflow.slice(
      workflow.indexOf("  test:\n"),
      workflow.indexOf("  node-package-boundary:\n"),
    );

    expect(testJob).toContain("- uses: actions/checkout@v4");
    expect(testJob).toContain("fetch-depth: 0");
  });

  it("keeps active orchestration entrypoints within their growth budgets", async () => {
    const limits = new Map([
      ["scripts/release.ts", 200],
      ["scripts/release/runner.ts", 800],
      ["scripts/research.ts", 800],
      ["scripts/research/c6/source-v4-capture.ts", 800],
      ["scripts/research/c6/legacy-inputs/source-v4.ts", 1_200],
    ]);
    const oversized: Array<{ lines: number; limit: number; path: string }> = [];
    for (const [path, limit] of limits) {
      const source = await readFile(join(REPOSITORY_ROOT, path), "utf8");
      const lines = source.trimEnd().split("\n").length;
      if (lines > limit) {
        oversized.push({ lines, limit, path });
      }
    }
    expect(oversized).toEqual([]);
  });

  it("runs historical research only inside its bound checkout", async () => {
    const [research, capture] = await Promise.all([
      readFile(join(REPOSITORY_ROOT, "scripts/research.ts"), "utf8"),
      readFile(
        join(
          REPOSITORY_ROOT,
          "scripts/research/c6/source-v4-capture.ts",
        ),
        "utf8",
      ),
    ]);
    const checkoutFlow = research.slice(
      research.indexOf("const legacy = await withGitSourceCheckout("),
      research.indexOf("const result = await executeProtocol("),
    );

    expect(checkoutFlow).toContain("runExactHistoricalGates(");
    expect(checkoutFlow).toContain("installBoundDependencies(");
    expect(checkoutFlow).toContain("verifyGitSourceStability(");
    expect(checkoutFlow).toContain("protocol.inputSourceIdentity");
    expect(checkoutFlow.indexOf("loadBoundLegacyProjection(")).toBeLessThan(
      checkoutFlow.indexOf("runExactHistoricalGates("),
    );
    expect(checkoutFlow.indexOf("runExactHistoricalGates(")).toBeLessThan(
      checkoutFlow.lastIndexOf("verifyGitSourceStability("),
    );
    expect(research).toContain("cwd: checkoutRoot");
    expect(research).toContain('"--frozen-lockfile"');
    expect(research).toContain('"--ignore-scripts"');
    expect(research.match(/"--no-install"/gu)).toHaveLength(2);
    expect(research).not.toContain("linkCurrentDependencies");
    expect(research).toContain("snapshotRoot: resolve(resolved)");
    expect(capture).not.toContain("loadLegacySourceV4Projection");
    expect(capture).not.toContain("codex-coding-effect/");
  });

  it("keeps historical research entrypoints out of the package script API", async () => {
    const pkg = JSON.parse(
      await readFile(join(REPOSITORY_ROOT, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};

    expect(scripts["research:list"]).toBe("bun scripts/research.ts list");
    expect(scripts["research:run"]).toBe("bun scripts/research.ts run");
    expect(scripts["research:verify"]).toBe("bun scripts/research.ts verify");
    expect(scripts["release:prepare"]).toBe("bun scripts/release.ts prepare");
    expect(scripts["release:promote"]).toBeUndefined();

    const historicalAliases = Object.keys(scripts).filter((name) =>
      /phase-\d|codex-coding-effect:c[345](?:\b|:)|source-v[123]|wave3|gate:v0(?:-|\.7)/iu
        .test(name)
    );
    expect(historicalAliases).toEqual([]);
  });

  it("keeps release workflow on one prepared artifact set", async () => {
    const workflow = await readFile(
      join(REPOSITORY_ROOT, ".github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain("bun scripts/release.ts prepare");
    expect(workflow).not.toContain("--strict");
    expect(workflow).not.toContain("reports/release/v0.7/");
    expect(workflow).not.toContain("prepare-v0-7-stable-artifact.ts");
    expect(workflow).not.toContain("verify-v0-7-release-artifact.ts");
    expect(workflow).not.toContain("bun pm pack");
    expect(workflow).toContain("steps.prepare.outputs.artifact_path");
    expect(workflow).toContain("steps.prepare.outputs.manifest_path");
    expect(workflow).toContain("steps.prepare.outputs.archive_path");
    expect(workflow).toContain(
      "npm publish --access public \"${{ steps.prepare.outputs.artifact_path }}\"",
    );
    expect(workflow).toContain(
      'if [ "$GITHUB_EVENT_NAME" = "push" ] && [ "$GITHUB_REF_TYPE" = "tag" ] && [ "$GITHUB_REF_NAME" != "v$VERSION" ]; then',
    );
    expect(workflow).toContain(
      "Trigger tag $GITHUB_REF_NAME does not match prepared version $VERSION",
    );
    expect(workflow).toContain(
      "Tag-triggered publication requires stable source metadata",
    );
    expect(workflow).toContain("status: manifest.package.status");
    const publicationCondition =
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/') && steps.prepare.outputs.status == 'stable'";
    expect(workflow.split(publicationCondition)).toHaveLength(4);
    expect(workflow).toContain("prerelease: false");
    expect(workflow).toContain("make_latest: true");

    const registryVerification = workflow.indexOf(
      "npm artifact identity verification failed",
    );
    const githubRelease = workflow.indexOf("Create GitHub release");
    expect(registryVerification).toBeGreaterThan(-1);
    expect(githubRelease).toBeGreaterThan(registryVerification);
  });

  it("publishes only for a stable matching tag push", () => {
    const stableTag = {
      manifestStatus: "stable",
      ref: "refs/tags/v0.7.5",
      refName: "v0.7.5",
      version: "0.7.5",
    };

    expect(publicationAllowed({ ...stableTag, eventName: "workflow_dispatch" }))
      .toBe(false);
    expect(publicationAllowed({
      ...stableTag,
      eventName: "push",
      manifestStatus: "release-candidate",
    })).toBe(false);
    expect(publicationAllowed({
      ...stableTag,
      eventName: "push",
      refName: "v0.7.4",
    })).toBe(false);
    expect(publicationAllowed({ ...stableTag, eventName: "push" })).toBe(true);
  });

  it("keeps current public docs off removed package aliases", async () => {
    const [
      chineseReadme,
      currentStatus,
      implicitMemBench,
      packageRaw,
      reproducing,
      sequentialHardening,
    ] = await Promise.all([
      readFile(join(REPOSITORY_ROOT, "README.zh-CN.md"), "utf8"),
      readFile(
        join(REPOSITORY_ROOT, "docs/GoodMemory-Current-Status-and-Evidence.md"),
        "utf8",
      ),
      readFile(
        join(
          REPOSITORY_ROOT,
          "docs/GoodMemory-ImplicitMemBench-Full-300-Research-Summary.md",
        ),
        "utf8",
      ),
      readFile(join(REPOSITORY_ROOT, "package.json"), "utf8"),
      readFile(join(REPOSITORY_ROOT, "REPRODUCING.md"), "utf8"),
      readFile(
        join(REPOSITORY_ROOT, "docs/Sequential Benchmark Hardening Plan.md"),
        "utf8",
      ),
    ]);

    expect(chineseReadme).not.toContain("bun run gate:v0.7");
    expect(currentStatus).not.toContain("bun run test:legacy-fitted");
    expect(currentStatus).toContain(
      "scripts/release/capsules/v0.7.4-readiness.json",
    );
    expect(reproducing).not.toMatch(/bun run (?:eval|gate|prepare|test):phase-/u);

    const scripts = (JSON.parse(packageRaw) as {
      scripts?: Record<string, string>;
    }).scripts ?? {};
    const violations = [
      ["GoodMemory-ImplicitMemBench-Full-300-Research-Summary.md", implicitMemBench],
      ["Sequential Benchmark Hardening Plan.md", sequentialHardening],
    ].flatMap(([path, content]) =>
      collectBunRunTargets(content!).filter((target) =>
        !target.startsWith("scripts/") && scripts[target] === undefined
      ).map((target) => `${path}: bun run ${target}`)
    );
    expect(violations).toEqual([]);
  });

  it("keeps the repository proof kernel out of production source", async () => {
    const sourceFiles = await collectTypeScriptFiles(join(REPOSITORY_ROOT, "src"));
    const violations: string[] = [];

    for (const path of sourceFiles) {
      const source = await readFile(path, "utf8");
      if (/from\s+["'][^"']*scripts\/proof(?:\/|["'])/u.test(source)) {
        violations.push(relative(REPOSITORY_ROOT, path));
      }
    }

    expect(violations).toEqual([]);
  });
});

async function collectTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files.sort();
}
