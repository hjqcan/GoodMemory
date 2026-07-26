import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const targetSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  canonicalOwner: z.string().min(1),
  canonicalRepository: z.string().min(1),
  captureDirectory: z.string().min(1),
  originalCaptureOrder: z.number().int().positive(),
  pullNumber: z.number().int().positive(),
  supplementOrder: z.number().int().positive(),
}).strict();
const planSchema = z.object({
  artifactKind: z.literal("c6-rest-identity-supplement-plan"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    captureExecuted: z.literal(false),
    codexRunReady: z.literal(false),
  }).passthrough(),
  counts: z.object({
    supplementTargetCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    supplementTargetProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(1),
  targets: z.array(targetSchema).min(1),
}).passthrough();
const pullSchema = z.object({
  base: z.object({
    repo: z.object({
      full_name: z.string().min(3),
    }).passthrough(),
  }).passthrough(),
  head: z.object({
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
  }).passthrough(),
  html_url: z.url(),
  number: z.number().int().positive(),
  user: z.object({
    login: z.string().min(1),
  }).passthrough(),
}).passthrough();

export interface C6RestIdentitySupplementCaptureResult {
  assetRootSha256: string;
  capturedTargetCount: number;
  captureAttemptCompletenessProven: true;
  outputRoot: string;
}

export type C6RestIdentitySupplementFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function captureC6RestIdentitySupplement(input: {
  authorizationToken: string;
  expectedPlanSha256: string;
  fetchImpl?: C6RestIdentitySupplementFetch;
  outputRoot: string;
  planPath: string;
}): Promise<C6RestIdentitySupplementCaptureResult> {
  const expectedPlanSha256 = sha256Schema.parse(input.expectedPlanSha256);
  if (
    input.authorizationToken.length === 0 ||
    input.authorizationToken.trim() !== input.authorizationToken
  ) {
    throw new Error(
      "C6 REST identity supplement authorization token is invalid",
    );
  }
  const planPath = await assertC6NoSymlinkPathComponents(
    input.planPath,
    "C6 REST identity supplement plan",
  );
  const planBytes = await readC6StableRegularFile(
    planPath,
    "REST identity supplement plan",
  );
  if (sha256(planBytes) !== expectedPlanSha256) {
    throw new Error("C6 REST identity supplement plan hash mismatch");
  }
  const rawPlan = parseJson(planBytes, "plan");
  const plan = planSchema.parse(rawPlan);
  if (
    plan.targets.length !== plan.counts.supplementTargetCount ||
    sha256(JSON.stringify(
      (rawPlan as { targets: unknown }).targets,
    )) !== plan.independenceBoundary.supplementTargetProjectionSha256
  ) {
    throw new Error(
      "C6 REST identity supplement plan projection mismatch",
    );
  }
  assertTargetOrder(plan.targets);
  const outputRoot = resolve(input.outputRoot);
  await assertC6NoSymlinkPathComponents(
    dirname(outputRoot),
    "C6 REST identity supplement output parent",
  );
  await assertOutputRootMissing(outputRoot);
  const temporaryRoot = `${outputRoot}.incomplete-${randomUUID()}`;
  await mkdir(temporaryRoot, { mode: 0o700 });
  const fetchImpl: C6RestIdentitySupplementFetch =
    input.fetchImpl ?? ((request, init) => fetch(request, init));
  let outputRootCreated = false;
  try {
    const captures = [];
    for (const target of plan.targets) {
      assertSafeComponent(target.captureDirectory, "capture directory");
      assertSafeComponent(target.canonicalOwner, "canonical owner");
      assertSafeComponent(
        target.canonicalRepository,
        "canonical repository",
      );
      const url = "https://api.github.com/repos/" +
        `${target.canonicalOwner}/${target.canonicalRepository}/pulls/` +
        target.pullNumber;
      const request = {
        headers: {
          accept: "application/vnd.github+json",
          apiVersion: "2022-11-28",
          authorization: "Bearer <redacted>",
          userAgent: "GoodMemory-C6-REST-Identity-Supplement",
        },
        method: "GET",
        url,
      };
      const response = await fetchImpl(url, {
        headers: {
          Accept: request.headers.accept,
          Authorization: `Bearer ${input.authorizationToken}`,
          "User-Agent": request.headers.userAgent,
          "X-GitHub-Api-Version": request.headers.apiVersion,
        },
        method: "GET",
        redirect: "error",
      });
      if (response.status !== 200) {
        throw new Error(
          "C6 REST identity supplement unexpected HTTP status " +
            `${response.status} for ${target.canonicalAnchorId}`,
        );
      }
      const responseBytes = Buffer.from(await response.arrayBuffer());
      assertTokenAbsent(
        responseBytes,
        input.authorizationToken,
        "pull response",
      );
      const pull = pullSchema.parse(parseJson(responseBytes, "pull response"));
      const canonicalRepository =
        `${target.canonicalOwner}/${target.canonicalRepository}`.toLowerCase();
      if (
        pull.number !== target.pullNumber ||
        pull.base.repo.full_name.toLowerCase() !== canonicalRepository
      ) {
        throw new Error(
          `C6 REST identity supplement pull identity mismatch ${
            target.canonicalAnchorId
          }`,
        );
      }
      const captureRoot = join(temporaryRoot, target.captureDirectory);
      await mkdir(captureRoot, { mode: 0o700 });
      const requestBytes = Buffer.from(
        `${JSON.stringify(request, null, 2)}\n`,
      );
      assertTokenAbsent(
        requestBytes,
        input.authorizationToken,
        "request receipt",
      );
      await Promise.all([
        writeFile(join(captureRoot, "request.json"), requestBytes, {
          flag: "wx",
          mode: 0o600,
        }),
        writeFile(join(captureRoot, "response.json"), responseBytes, {
          flag: "wx",
          mode: 0o600,
        }),
      ]);
      const capture = {
        anchorId: target.anchorId,
        canonicalAnchorId: target.canonicalAnchorId,
        captureDirectory: target.captureDirectory,
        headSha: pull.head.sha,
        originalCaptureOrder: target.originalCaptureOrder,
        pullAuthor: pull.user.login,
        pullNumber: target.pullNumber,
        requestSha256: sha256(requestBytes),
        responseBytes: responseBytes.byteLength,
        responseSha256: sha256(responseBytes),
        supplementOrder: target.supplementOrder,
      };
      const manifestBytes = Buffer.from(
        `${JSON.stringify({
          artifactKind: "c6-rest-identity-supplement-capture",
          boundary: {
            bearerAuthorizationHeaderSent: true,
            cryptographicPlatformReceipt: false,
            platformAuthenticationCryptographicallyProven: false,
          },
          capture,
          request: {
            path: "request.json",
            sha256: capture.requestSha256,
          },
          response: {
            bytes: capture.responseBytes,
            path: "response.json",
            sha256: capture.responseSha256,
            status: 200,
          },
          schemaVersion: 1,
        }, null, 2)}\n`,
      );
      assertTokenAbsent(
        manifestBytes,
        input.authorizationToken,
        "capture manifest",
      );
      await writeFile(
        join(captureRoot, "manifest.json"),
        manifestBytes,
        { flag: "wx", mode: 0o600 },
      );
      captures.push(capture);
    }
    const terminalPlanBytes = await readC6StableRegularFile(
      planPath,
      "REST identity supplement terminal plan",
    );
    if (!terminalPlanBytes.equals(planBytes)) {
      throw new Error(
        "C6 REST identity supplement plan changed during capture",
      );
    }
    const captureRootBytes = Buffer.from(
      `${JSON.stringify({
        artifactKind: "c6-rest-identity-supplement-capture-root",
        boundary: {
          bearerAuthorizationHeaderSent: true,
          captureAttemptCompletenessProven: true,
          cryptographicPlatformReceipt: false,
          platformAuthenticationCryptographicallyProven: false,
        },
        captures,
        counts: {
          capturedTargetCount: captures.length,
          plannedTargetCount: plan.targets.length,
        },
        plan: {
          bytes: planBytes.byteLength,
          path: basename(planPath),
          sha256: expectedPlanSha256,
          targetProjectionSha256:
            plan.independenceBoundary.supplementTargetProjectionSha256,
        },
        schemaVersion: 1,
      }, null, 2)}\n`,
    );
    assertTokenAbsent(
      captureRootBytes,
      input.authorizationToken,
      "capture root manifest",
    );
    await writeFile(
      join(temporaryRoot, "capture.json"),
      captureRootBytes,
      { flag: "wx", mode: 0o600 },
    );
    const prepublicationLock = await buildC6AssetLock(temporaryRoot);
    await assertC6NoSymlinkPathComponents(
      dirname(outputRoot),
      "C6 REST identity supplement output parent",
    );
    await assertOutputRootMissing(outputRoot);
    try {
      await mkdir(outputRoot, { mode: 0o700 });
      outputRootCreated = true;
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        throw new Error(
          "C6 REST identity supplement output root already exists",
        );
      }
      throw error;
    }
    const entries = await readdir(temporaryRoot);
    entries.sort((left, right) => {
      if (left === "capture.json") {
        return 1;
      }
      if (right === "capture.json") {
        return -1;
      }
      return left.localeCompare(right);
    });
    for (const entry of entries) {
      await publishNoReplace(
        join(temporaryRoot, entry),
        join(outputRoot, entry),
      );
    }
    const publishedLock = await buildC6AssetLock(outputRoot);
    if (
      serializeC6AssetLock(publishedLock) !==
        serializeC6AssetLock(prepublicationLock)
    ) {
      throw new Error(
        "C6 REST identity supplement published asset closure mismatch",
      );
    }
    await rm(temporaryRoot, { recursive: true });
    return {
      assetRootSha256: publishedLock.assetRootSha256,
      capturedTargetCount: plan.targets.length,
      captureAttemptCompletenessProven: true,
      outputRoot,
    };
  } catch (error) {
    await rm(temporaryRoot, { force: true, recursive: true });
    if (outputRootCreated) {
      await rm(outputRoot, { force: true, recursive: true });
    }
    throw error;
  }
}

function assertTargetOrder(
  targets: readonly z.infer<typeof targetSchema>[],
): void {
  const directories = new Set<string>();
  for (const [index, target] of targets.entries()) {
    if (
      target.supplementOrder !== index + 1 ||
      directories.has(target.captureDirectory)
    ) {
      throw new Error(
        "C6 REST identity supplement target order is invalid",
      );
    }
    directories.add(target.captureDirectory);
  }
}

function assertSafeComponent(value: string, label: string): void {
  if (
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error(
      `C6 REST identity supplement unsafe ${label} ${value}`,
    );
  }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 REST identity supplement invalid ${label} JSON`,
    );
  }
}

async function assertOutputRootMissing(outputRoot: string): Promise<void> {
  try {
    await lstat(outputRoot);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  throw new Error(
    "C6 REST identity supplement output root already exists",
  );
}

async function publishNoReplace(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const stat = await lstat(sourcePath);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `C6 REST identity supplement refuses symlink ${sourcePath}`,
    );
  }
  if (stat.isDirectory()) {
    await mkdir(destinationPath, { mode: stat.mode & 0o777 });
    for (const entry of (await readdir(sourcePath)).sort()) {
      await publishNoReplace(
        join(sourcePath, entry),
        join(destinationPath, entry),
      );
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error(
      `C6 REST identity supplement refuses non-file ${sourcePath}`,
    );
  }
  await link(sourcePath, destinationPath);
}

function assertTokenAbsent(
  bytes: Uint8Array,
  token: string,
  label: string,
): void {
  if (Buffer.from(bytes).includes(Buffer.from(token))) {
    throw new Error(
      `C6 REST identity supplement authorization token appeared in ${label}`,
    );
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
