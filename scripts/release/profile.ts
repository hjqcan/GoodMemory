import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ReleaseCheckStatus,
  ReleaseProfile,
  ReleaseStatus,
} from "./contracts";

const V07_READINESS_CAPSULE_SHA256 =
  "7fc8c2b15c8d2ab8aac7e55922ffb7af837fb12336a37f88fae200716d0f7bd0";

export const V07_HISTORICAL_ONLY_CHECK_IDS = [
  "v0.7.3-lifecycle-protection",
  "v0.7.3-protocol-source",
  "v0.7.3-lifecycle-source",
  "v0.7.3-stable-source-test-correction",
  "v0.7.3-cross-host-lifecycle-verifier-correction",
] as const;

export const V07_ACTIVE_LEGACY_CHECK_IDS = [
  "source-identity",
  "runtime-identity",
  "release-source-identity",
  "version",
  "typecheck",
  "tests",
  "coverage",
  "build",
  "public-claims",
  "scale",
  "postgres",
  "pack",
  "language-consumers",
  "source-stability",
] as const;

export const V07_HISTORICAL_CAPSULE_CHECK_ID =
  "historical-release-capsule";

const REQUIRED_PACKED_FILES = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/ai-sdk/index.js",
  "dist/ai-sdk/index.d.ts",
  "dist/host/index.js",
  "dist/host/index.d.ts",
  "dist/http/index.js",
  "dist/http/index.d.ts",
  "dist/runtime-kit/index.js",
  "dist/runtime-kit/index.d.ts",
  "docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
  "package.json",
] as const;

const V07_COMMAND_CHECKS = [
  {
    args: ["run", "typecheck"],
    command: "bun",
    id: "typecheck",
    required: true,
    successDetail: "strict TypeScript checks passed",
    title: "TypeScript typecheck",
  },
  {
    args: ["test", "--timeout=300000"],
    command: "bun",
    id: "tests",
    required: true,
    successDetail: "canonical Bun test suite passed",
    title: "Full canonical Bun test suite",
  },
  {
    args: ["run", "test:coverage"],
    command: "bun",
    id: "coverage",
    required: true,
    successDetail: "coverage gates passed",
    title: "Coverage gates",
  },
  {
    args: ["run", "build"],
    command: "bun",
    id: "build",
    required: true,
    successDetail: "compiled JavaScript and declarations built",
    title: "Compiled package build",
  },
  {
    args: ["run", "gate:public-benchmark-claim", "--strict"],
    command: "bun",
    id: "public-claims",
    required: true,
    successDetail: "public benchmark claim gate passed",
    title: "Public benchmark claim gate",
  },
  {
    args: [
      "scripts/run-projection-storage-scale-gate.ts",
      "--output",
      { outputPath: "evidence/projection-storage-scale-gate.json" },
    ],
    command: "bun",
    generatedEvidence: {
      id: "projection-storage-scale-gate",
      path: "evidence/projection-storage-scale-gate.json",
    },
    id: "scale",
    required: true,
    successDetail: "projection storage scale gate passed",
    title: "Projection storage scale gate (100k searchable / 150k stored)",
  },
  {
    args: [
      "test",
      "tests/integration/storage.postgres.test.ts",
      "tests/integration/api.postgres.test.ts",
    ],
    command: "bun",
    id: "postgres",
    required: true,
    requiredEnvironment: "GOODMEMORY_TEST_POSTGRES_URL",
    successDetail: "real Postgres release gates passed",
    title: "Real Postgres functionality, migration, scale, and EXPLAIN gates",
  },
] as const;

const LANGUAGE_CONSUMER_SMOKE = `
import {
  createChineseLanguagePack,
  createEnglishLanguagePack,
  createFrenchLanguagePack,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createLanguageService,
  createSpanishLanguagePack,
} from "goodmemory";

const language = createLanguageService({
  defaultLocale: "zh-TW",
  packs: [
    createEnglishLanguagePack(),
    createChineseLanguagePack("Hans"),
    createChineseLanguagePack("Hant"),
    createJapaneseLanguagePack(),
    createKoreanLanguagePack(),
    createFrenchLanguagePack(),
    createSpanishLanguagePack(),
  ],
});
const cases = [
  ["en-US", "release memory", "en", "release"],
  ["zh-CN", "简体中文记忆", "zh-Hans", "简体"],
  ["zh-TW", "繁體中文記憶", "zh-Hant", "繁體"],
  ["ja-JP", "日本語の記憶", "ja", "日本語"],
  ["ko-KR", "한국어 기억", "ko", "한국어"],
  ["fr-FR", "mémoire française", "fr", "mémoire"],
  ["es-ES", "memoria española", "es", "memoria"],
];
for (const [locale, text, packId, term] of cases) {
  const analysis = language.resolveFromText({ locale, text });
  if (analysis.languagePackId !== packId) throw new Error(packId + " pack unresolved");
  if (!language.buildSearchTerms(text, analysis).includes(term)) {
    throw new Error(packId + " search terms unavailable");
  }
}
console.log("LANGUAGE_CONSUMER_OK");
`;

interface PackageJson {
  engines?: {
    bun?: unknown;
    node?: unknown;
  };
  goodmemoryRelease?: {
    installCommandsApplyAfterPublish?: unknown;
    npmDistTag?: unknown;
    status?: unknown;
  };
  name?: unknown;
  version?: unknown;
}

interface LegacyReadinessReport {
  checks?: unknown;
}

export interface LegacyReadinessParity {
  active: Array<{ id: string; status: ReleaseCheckStatus }>;
  historical: Array<{ id: string; status: ReleaseCheckStatus }>;
  replacementCheckId: typeof V07_HISTORICAL_CAPSULE_CHECK_ID;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required in package.json`);
  }
  return value.trim();
}

function releaseStatus(value: unknown): ReleaseStatus {
  if (value !== "release-candidate" && value !== "stable") {
    throw new Error("goodmemoryRelease.status must be release-candidate or stable");
  }
  return value;
}

export function satisfiesReleaseRuntimePolicy(
  actual: string,
  policy: string,
): boolean {
  const expected = policy.match(/^>=(\d+)\.(\d+)\.(\d+)$/u)?.slice(1).map(Number);
  const match = actual.match(/v?(\d+)\.(\d+)\.(\d+)/u);
  const found = match?.slice(1).map(Number);
  if (!expected || !found) {
    return false;
  }
  for (const [index, part] of found.entries()) {
    if (part !== expected[index]) {
      return part > expected[index];
    }
  }
  return true;
}

function parseLegacyChecks(value: unknown): Array<{
  id: string;
  status: ReleaseCheckStatus;
}> {
  if (!Array.isArray(value)) {
    throw new Error("legacy readiness report checks must be an array");
  }
  return value
    .filter((entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && entry.required === true
    )
    .map((entry) => {
      const status = entry.status;
      if (status !== "fail" && status !== "pass" && status !== "skip") {
        throw new Error(`legacy readiness check ${String(entry.id)} has invalid status`);
      }
      return {
        id: requiredString(entry.id, "legacy readiness check id"),
        status,
      };
    });
}

export function projectV07LegacyReadinessParity(
  value: unknown,
): LegacyReadinessParity {
  const report = value as LegacyReadinessReport;
  const checks = parseLegacyChecks(report?.checks);
  const byId = new Map(checks.map((check) => [check.id, check]));
  if (byId.size !== checks.length) {
    throw new Error("legacy readiness report contains duplicate required check ids");
  }

  const expected = new Set([
    ...V07_ACTIVE_LEGACY_CHECK_IDS,
    ...V07_HISTORICAL_ONLY_CHECK_IDS,
  ]);
  const unexpected = checks
    .map((check) => check.id)
    .filter((id) => !expected.has(id as never));
  const missing = [...expected].filter((id) => !byId.has(id));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `legacy required check set drifted; missing=${missing.join(",") || "none"}; ` +
        `unexpected=${unexpected.join(",") || "none"}`,
    );
  }

  return {
    active: V07_ACTIVE_LEGACY_CHECK_IDS.map((id) => byId.get(id)!),
    historical: V07_HISTORICAL_ONLY_CHECK_IDS.map((id) => byId.get(id)!),
    replacementCheckId: V07_HISTORICAL_CAPSULE_CHECK_ID,
  };
}

export async function loadV07ReleaseProfile(
  repoRoot: string,
): Promise<ReleaseProfile> {
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  ) as PackageJson;
  const name = requiredString(packageJson.name, "name");
  const version = requiredString(packageJson.version, "version");
  if (name !== "goodmemory" || !/^0\.7\.\d+$/u.test(version)) {
    throw new Error(`v0.7 release profile cannot prepare ${name}@${version}`);
  }
  const release = packageJson.goodmemoryRelease;
  const status = releaseStatus(release?.status);
  const distTag = requiredString(
    release?.npmDistTag,
    "goodmemoryRelease.npmDistTag",
  );
  const expectedDistTag = status === "stable" ? "latest" : "next";
  if (distTag !== expectedDistTag) {
    throw new Error(
      `goodmemoryRelease.npmDistTag must be ${expectedDistTag} for ${status}`,
    );
  }
  if (release?.installCommandsApplyAfterPublish !== true) {
    throw new Error(
      "goodmemoryRelease.installCommandsApplyAfterPublish must be true",
    );
  }

  return {
    artifact: {
      consumerSmoke: LANGUAGE_CONSUMER_SMOKE,
      maxTarballBytes: 4 * 1024 * 1024,
      requiredFiles: REQUIRED_PACKED_FILES,
    },
    checks: V07_COMMAND_CHECKS,
    evidenceInputs: [{
      checkId: V07_HISTORICAL_CAPSULE_CHECK_ID,
      id: "v0.7.4-release-readiness-capsule",
      kind: "file",
      path: "scripts/release/capsules/v0.7.4-readiness.json",
      sha256: V07_READINESS_CAPSULE_SHA256,
      title: "Frozen v0.7.4 release readiness capsule",
    }],
    id: "goodmemory-v0.7",
    package: {
      distTag,
      installCommandsApplyAfterPublish: true,
      name,
      status,
      tarballName: `${name}-${version}.tgz`,
      version,
    },
    runtime: {
      bun: requiredString(packageJson.engines?.bun, "engines.bun"),
      node: requiredString(packageJson.engines?.node, "engines.node"),
    },
  };
}

export async function loadReleaseProfile(
  repoRoot: string,
): Promise<ReleaseProfile> {
  return loadV07ReleaseProfile(repoRoot);
}
