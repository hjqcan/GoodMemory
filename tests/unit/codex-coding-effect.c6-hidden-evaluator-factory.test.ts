import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  evaluateC6HiddenModuleCases,
} from "../../scripts/codex-coding-effect/c6-hidden-evaluator-factory";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("C6 hidden evaluator factory", () => {
  it("evaluates a frozen case spec against a TypeScript module export", async () => {
    const fixture = await createFixture({
      cases: [
        {
          args: [{ items: ["caller"] }, { items: ["default"] }],
          expected: { items: ["caller", "default"] },
          id: "array-precedence",
        },
        {
          args: [{ value: null }, { value: "fallback" }],
          expected: { value: "fallback" },
          id: "nullish-default",
        },
      ],
    });

    const result = await evaluateC6HiddenModuleCases({
      evaluatorSpecPath: fixture.specPath,
      repositoryRoot: fixture.repositoryRoot,
    });

    expect(result).toEqual({
      caseCount: 2,
      evaluationBundleSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      evaluatorSpecSha256: fixture.specSha256,
      factoryId: "bun-typescript-module-cases-v1",
      failedCaseIds: [],
      moduleSha256: fixture.moduleSha256,
      passed: true,
    });
  });

  it("returns exact failed case ids without exposing expected values", async () => {
    const fixture = await createFixture({
      cases: [
        {
          args: [{ items: ["caller"] }, { items: ["default"] }],
          expected: { items: ["default", "caller"] },
          id: "wrong-array-order",
        },
        {
          args: [{ value: 1 }, { value: 2 }],
          expected: { value: 1 },
          id: "unrelated-pass",
        },
      ],
    });

    expect(await evaluateC6HiddenModuleCases({
      evaluatorSpecPath: fixture.specPath,
      repositoryRoot: fixture.repositoryRoot,
    })).toEqual({
      caseCount: 2,
      evaluationBundleSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      evaluatorSpecSha256: fixture.specSha256,
      factoryId: "bun-typescript-module-cases-v1",
      failedCaseIds: ["wrong-array-order"],
      moduleSha256: fixture.moduleSha256,
      passed: false,
    });
  });

  it("treats mutation of JSON case arguments as a hidden-test failure", async () => {
    const fixture = await createFixture({
      cases: [
        {
          args: [{ value: "before" }, {}],
          expected: { value: "after" },
          id: "input-immutability",
        },
      ],
    });
    await writeFile(
      join(fixture.repositoryRoot, "src/defu.ts"),
      [
        "export function defu(",
        "  current: Record<string, unknown>,",
        "): Record<string, unknown> {",
        '  current.value = "after";',
        "  return current;",
        "}",
        "",
      ].join("\n"),
    );

    const result = await evaluateC6HiddenModuleCases({
      evaluatorSpecPath: fixture.specPath,
      repositoryRoot: fixture.repositoryRoot,
    });

    expect(result.passed).toBeFalse();
    expect(result.failedCaseIds).toEqual(["input-immutability"]);
  });

  it("rejects evaluator specs inside the agent-visible repository", async () => {
    const fixture = await createFixture({ cases: [] });
    const visibleSpecPath = join(
      fixture.repositoryRoot,
      "visible-evaluator.json",
    );
    await writeFile(visibleSpecPath, fixture.specBytes);

    await expect(evaluateC6HiddenModuleCases({
      evaluatorSpecPath: visibleSpecPath,
      repositoryRoot: fixture.repositoryRoot,
    })).rejects.toThrow(
      "hidden evaluator spec must stay outside the agent-visible repository",
    );
  });

  it("rejects module traversal and unknown evaluator contracts", async () => {
    const traversal = await createFixture({
      cases: [
        {
          args: [{ value: 1 }, { value: 2 }],
          expected: { value: 1 },
          id: "valid-case",
        },
      ],
      modulePath: "../outside.ts",
    });
    await expect(evaluateC6HiddenModuleCases({
      evaluatorSpecPath: traversal.specPath,
      repositoryRoot: traversal.repositoryRoot,
    })).rejects.toThrow("invalid C6 hidden evaluator spec");

    const unknown = await createFixture({
      cases: [
        {
          args: [{ value: 1 }, { value: 2 }],
          expected: { value: 1 },
          id: "valid-case",
        },
      ],
      factoryId: "other-factory",
    });
    await expect(evaluateC6HiddenModuleCases({
      evaluatorSpecPath: unknown.specPath,
      repositoryRoot: unknown.repositoryRoot,
    })).rejects.toThrow("invalid C6 hidden evaluator spec");
  });
});

interface CaseSpec {
  args: unknown[];
  expected: unknown;
  id: string;
}

async function createFixture(input: {
  cases: CaseSpec[];
  factoryId?: string;
  modulePath?: string;
}): Promise<{
  moduleSha256: string;
  repositoryRoot: string;
  specBytes: string;
  specPath: string;
  specSha256: string;
}> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "goodmemory-c6-hidden-evaluator-")),
  );
  roots.push(root);
  const repositoryRoot = join(root, "repository");
  const evaluatorRoot = join(root, "hidden");
  await Promise.all([
    mkdir(join(repositoryRoot, "src"), { recursive: true }),
    mkdir(evaluatorRoot, { recursive: true }),
  ]);
  const moduleBytes = [
    "export function defu(",
    "  current: Record<string, unknown>,",
    "  defaults: Record<string, unknown>,",
    "): Record<string, unknown> {",
    "  const result = { ...defaults };",
    "  for (const [key, value] of Object.entries(current)) {",
    "    if (value === null || value === undefined) continue;",
    "    if (Array.isArray(value) && Array.isArray(result[key])) {",
    "      result[key] = [...value, ...result[key] as unknown[]];",
    "    } else {",
    "      result[key] = value;",
    "    }",
    "  }",
    "  return result;",
    "}",
    "",
  ].join("\n");
  await writeFile(join(repositoryRoot, "src/defu.ts"), moduleBytes);
  const spec = {
    cases: input.cases,
    exportName: "defu",
    factoryId: input.factoryId ?? "bun-typescript-module-cases-v1",
    modulePath: input.modulePath ?? "src/defu.ts",
    schemaVersion: 1,
  };
  const specBytes = `${JSON.stringify(spec, null, 2)}\n`;
  const specPath = join(evaluatorRoot, "cases.json");
  await writeFile(specPath, specBytes);
  return {
    moduleSha256: Bun.CryptoHasher.hash("sha256", moduleBytes, "hex"),
    repositoryRoot,
    specBytes,
    specPath,
    specSha256: Bun.CryptoHasher.hash("sha256", specBytes, "hex"),
  };
}
