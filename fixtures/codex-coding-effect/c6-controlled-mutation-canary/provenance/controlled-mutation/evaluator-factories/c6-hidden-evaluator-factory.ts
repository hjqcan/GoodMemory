import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  readC6StableRegularFile,
} from "./c6-asset-lock";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const relativeModulePathSchema = z.string().min(1).refine(
  (value) =>
    !isAbsolute(value) &&
    !value.includes("\\") &&
    value.split("/").every((part) =>
      part.length > 0 && part !== "." && part !== ".."
    ),
  "module path must be a normalized relative POSIX path",
);
const caseSchema = z.object({
  args: z.array(z.unknown()),
  expected: z.unknown(),
  id: identifierSchema,
}).strict();
const evaluatorSpecSchema = z.object({
  cases: z.array(caseSchema).min(1),
  exportName: z.union([z.literal("default"), identifierSchema]),
  factoryId: z.literal("bun-typescript-module-cases-v1"),
  modulePath: relativeModulePathSchema,
  schemaVersion: z.literal(1),
}).strict().superRefine((spec, context) => {
  const caseIds = new Set<string>();
  for (const [index, testCase] of spec.cases.entries()) {
    if (caseIds.has(testCase.id)) {
      context.addIssue({
        code: "custom",
        message: "evaluator spec repeats a case id",
        path: ["cases", index, "id"],
      });
    }
    caseIds.add(testCase.id);
  }
});

export interface C6HiddenModuleCaseResult {
  caseCount: number;
  evaluationBundleSha256: string;
  evaluatorSpecSha256: string;
  factoryId: "bun-typescript-module-cases-v1";
  failedCaseIds: string[];
  moduleSha256: string;
  passed: boolean;
}

export async function evaluateC6HiddenModuleCases(input: {
  evaluatorSpecPath: string;
  repositoryRoot: string;
}): Promise<C6HiddenModuleCaseResult> {
  const repositoryRoot = await realpath(input.repositoryRoot);
  const evaluatorSpecPath = await realpath(input.evaluatorSpecPath);
  if (isWithin(repositoryRoot, evaluatorSpecPath)) {
    throw new Error(
      "C6 hidden evaluator spec must stay outside the agent-visible repository",
    );
  }
  if ((await lstat(evaluatorSpecPath)).isSymbolicLink()) {
    throw new Error("C6 hidden evaluator spec cannot be a symlink");
  }

  const evaluatorSpecBytes = await readC6StableRegularFile(
    evaluatorSpecPath,
    "hidden evaluator spec",
  );
  const spec = parseCanonicalSpec(evaluatorSpecBytes.toString("utf8"));
  const moduleCandidate = resolve(repositoryRoot, spec.modulePath);
  if (!isWithin(repositoryRoot, moduleCandidate)) {
    throw new Error(
      "C6 evaluator module path must stay inside the agent-visible repository",
    );
  }
  const modulePath = await realpath(moduleCandidate);
  if (
    modulePath !== moduleCandidate ||
    (await lstat(modulePath)).isSymbolicLink()
  ) {
    throw new Error("C6 evaluator module cannot resolve through a symlink");
  }
  const moduleBytes = await readC6StableRegularFile(
    modulePath,
    "hidden evaluator target module",
  );
  const moduleSha256 = sha256(moduleBytes);
  const evaluatorSpecSha256 = sha256(evaluatorSpecBytes);
  const build = await Bun.build({
    entrypoints: [modulePath],
    format: "cjs",
    minify: true,
    sourcemap: "none",
    splitting: false,
    target: "bun",
  });
  if (!build.success || build.outputs.length !== 1) {
    throw new Error("C6 evaluator could not bundle target module");
  }
  const evaluationBundle = Buffer.from(
    await build.outputs[0]!.arrayBuffer(),
  );
  const evaluationBundleSha256 = sha256(evaluationBundle);
  const runtimeModule: {
    exports: Record<string, unknown>;
  } = { exports: {} };
  const execute = new Function(
    `return (\n${evaluationBundle.toString("utf8")}\n);`,
  )() as (
    exports: Record<string, unknown>,
    require: NodeJS.Require,
    module: typeof runtimeModule,
    filename: string,
    dirname: string,
  ) => void;
  execute(
    runtimeModule.exports,
    createRequire(modulePath),
    runtimeModule,
    modulePath,
    resolve(modulePath, ".."),
  );
  const imported = runtimeModule.exports;
  const exported = imported[spec.exportName];
  if (typeof exported !== "function") {
    throw new Error(
      `C6 evaluator target export ${spec.exportName} is not a function`,
    );
  }

  const failedCaseIds: string[] = [];
  for (const testCase of spec.cases) {
    try {
      const argsBefore = structuredClone(testCase.args);
      const actual = await exported(...testCase.args);
      if (
        !isDeepStrictEqual(actual, testCase.expected) ||
        !isDeepStrictEqual(testCase.args, argsBefore)
      ) {
        failedCaseIds.push(testCase.id);
      }
    } catch {
      failedCaseIds.push(testCase.id);
    }
  }

  return {
    caseCount: spec.cases.length,
    evaluationBundleSha256,
    evaluatorSpecSha256,
    factoryId: spec.factoryId,
    failedCaseIds,
    moduleSha256,
    passed: failedCaseIds.length === 0,
  };
}

function parseCanonicalSpec(bytes: string): z.infer<
  typeof evaluatorSpecSchema
> {
  let json: unknown;
  try {
    json = JSON.parse(bytes);
  } catch {
    throw new Error("invalid C6 hidden evaluator spec JSON");
  }
  const parsed = evaluatorSpecSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`invalid C6 hidden evaluator spec: ${parsed.error.message}`);
  }
  if (`${JSON.stringify(parsed.data, null, 2)}\n` !== bytes) {
    throw new Error("C6 hidden evaluator spec is not canonical JSON");
  }
  return parsed.data;
}

function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return (
    child.length > 0 &&
    child !== ".." &&
    !child.startsWith("../") &&
    !isAbsolute(child)
  );
}

function sha256(value: string | Uint8Array): string {
  const digest = createHash("sha256").update(value).digest("hex");
  return sha256Schema.parse(digest);
}
