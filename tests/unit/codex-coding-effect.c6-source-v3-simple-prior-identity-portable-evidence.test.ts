import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "bun:test";

import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  parseC6SourceV3SimplePriorIdentityPortableEvidenceManifest,
  serializeC6SourceV3SimplePriorIdentityPortableEvidenceManifest,
  verifyC6SourceV3SimplePriorIdentityPortableEvidence,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-identity-portable-evidence";
import {
  captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity";
import {
  buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
  serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-replay";
import {
  buildC6SourceV3SimplePriorRepositoryIdentityStructure,
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
  serializeC6SourceV3SimplePriorRepositoryIdentityStructure,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-structure";
import {
  parseC6Wave3PriorRepositoryIdentityPlan,
} from "../../scripts/codex-coding-effect/c6-wave3-prior-repository-identity-plan";
import {
  materializeC6SourceV3SimplePriorIdentityPortableEvidence,
  parseC6SourceV3SimplePriorIdentityPortableEvidenceCliOptions,
} from "../../scripts/materialize-codex-coding-effect-c6-source-v3-simple-prior-identity-portable-evidence";

const execFileAsync = promisify(execFile);
const SOURCE_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const PROTOCOL_PATH = join(
  SOURCE_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "source-v3-simple-protocol-v1.json",
);
const PLAN_PATH = join(
  SOURCE_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "wave3-prior-repository-identity-plan-v1.json",
);
const SOURCE_PATH = join(
  SOURCE_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "wave3-source-universe-v2.json",
);
const TOKEN = "github_pat_C6_PORTABLE_TEST_SENTINEL_947301";
const RESET_AT = "2026-07-25T13:00:00Z";
const RESET_EPOCH = String(Date.parse(RESET_AT) / 1_000);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 source-v3-simple prior identity portable evidence", () => {
  it("materializes create-only reproducible archives and replays without source roots", async () => {
    const parent = await temporaryRoot("portable");
    const captureA = await materializeBundle(
      join(parent, "capture-a"),
      "PORTABLEA",
    );
    const captureB = await materializeBundle(
      join(parent, "capture-b"),
      "PORTABLEB",
    );
    const replayReceiptPath = join(parent, "replay.json");
    const receipt =
      await buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt({
        captureA,
        captureB,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      });
    await writeFile(
      replayReceiptPath,
      serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
        receipt,
      ),
    );
    const outputRoot = join(parent, "portable-one");
    const options = {
      captureA,
      captureB,
      outputRoot,
      planPath: PLAN_PATH,
      protocolPath: PROTOCOL_PATH,
      replayReceiptPath,
      sourceUniversePath: SOURCE_PATH,
    };

    const result =
      await materializeC6SourceV3SimplePriorIdentityPortableEvidence(
        options,
      );
    expect(result).toMatchObject({
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      externalAuthenticityVerified: false,
      formalCensusPermitted: false,
      independentCaptureProcessProven: false,
      liveNetworkExecutionProven: false,
      portableEvidenceClosureVerified: true,
      priorRepositoryNodeIdExclusionComplete: false,
      repositoryIdentityReplayAgreementObserved: true,
      sourceV3SimpleFrozen: false,
    });
    const firstArchiveA = await readFile(
      join(outputRoot, "capture-a.tar.gz"),
    );
    const firstArchiveB = await readFile(
      join(outputRoot, "capture-b.tar.gz"),
    );
    const firstManifest = await readFile(
      join(outputRoot, "portable-evidence.json"),
    );
    const parsed =
      parseC6SourceV3SimplePriorIdentityPortableEvidenceManifest(
        firstManifest,
      );
    expect(parsed.boundary).toEqual({
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      externalAuthenticityVerified: false,
      formalCensusPermitted: false,
      independentCaptureProcessProven: false,
      liveNetworkExecutionProven: false,
      portableEvidenceClosureVerified: true,
      priorRepositoryNodeIdExclusionComplete: false,
      repositoryIdentityReplayAgreementObserved: true,
      sourceV3SimpleFrozen: false,
    });
    expect(parsed.replayReceipt.canonicalJson).toBe(
      serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
        receipt,
      ),
    );

    await expect(
      materializeC6SourceV3SimplePriorIdentityPortableEvidence(
        options,
      ),
    ).rejects.toThrow("output root already exists");
    expect(
      await readFile(
        join(outputRoot, "portable-evidence.json"),
      ),
    ).toEqual(firstManifest);

    const secondOutputRoot = join(parent, "portable-two");
    await materializeC6SourceV3SimplePriorIdentityPortableEvidence({
      ...options,
      outputRoot: secondOutputRoot,
    });
    expect(
      await readFile(
        join(secondOutputRoot, "capture-a.tar.gz"),
      ),
    ).toEqual(firstArchiveA);
    expect(
      await readFile(
        join(secondOutputRoot, "capture-b.tar.gz"),
      ),
    ).toEqual(firstArchiveB);

    await Promise.all([
      rm(captureA, { recursive: true }),
      rm(captureB, { recursive: true }),
      rm(replayReceiptPath),
    ]);
    await expect(
      verifyC6SourceV3SimplePriorIdentityPortableEvidence({
        outputRoot,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      }),
    ).resolves.toMatchObject({
      portableEvidenceClosureVerified: true,
      repositoryIdentityReplayAgreementObserved: true,
    });
  }, 60_000);

  it("rejects archive drift, extra assets, escape paths, links, receipt mutation, and authority claims", async () => {
    const parent = await temporaryRoot("portable-mutation");
    const captureA = await materializeBundle(
      join(parent, "capture-a"),
      "MUTATIONA",
    );
    const captureB = await materializeBundle(
      join(parent, "capture-b"),
      "MUTATIONB",
    );
    const replayReceiptPath = join(parent, "replay.json");
    const receipt =
      await buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt({
        captureA,
        captureB,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      });
    await writeFile(
      replayReceiptPath,
      serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
        receipt,
      ),
    );
    const outputRoot = join(parent, "portable");
    await materializeC6SourceV3SimplePriorIdentityPortableEvidence({
      captureA,
      captureB,
      outputRoot,
      planPath: PLAN_PATH,
      protocolPath: PROTOCOL_PATH,
      replayReceiptPath,
      sourceUniversePath: SOURCE_PATH,
    });
    const verify = (root: string) =>
      verifyC6SourceV3SimplePriorIdentityPortableEvidence({
        outputRoot: root,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      });

    const driftRoot = await copyEvidence(
      outputRoot,
      join(parent, "drift"),
    );
    const driftPath = join(driftRoot, "capture-a.tar.gz");
    const driftBytes = await readFile(driftPath);
    driftBytes[20] = driftBytes[20]! ^ 0xff;
    await writeFile(driftPath, driftBytes);
    await expect(verify(driftRoot)).rejects.toThrow(
      "archive reference mismatch",
    );

    const extraSource = join(parent, "extra-source");
    await cp(captureA, extraSource, { recursive: true });
    await writeFile(join(extraSource, "extra.txt"), "extra\n");
    const extraRoot = await copyEvidence(
      outputRoot,
      join(parent, "extra"),
    );
    const extraArchive = join(
      extraRoot,
      "capture-a.tar.gz",
    );
    await createTar(extraSource, extraArchive);
    await updateArchiveReference(extraRoot, extraArchive);
    await expect(verify(extraRoot)).rejects.toThrow();

    const escapeRoot = await copyEvidence(
      outputRoot,
      join(parent, "escape"),
    );
    const escapeArchive = join(
      escapeRoot,
      "capture-a.tar.gz",
    );
    await writeFile(
      escapeArchive,
      maliciousArchive("../escape", "0"),
    );
    await updateArchiveReference(escapeRoot, escapeArchive);
    await expect(verify(escapeRoot)).rejects.toThrow(
      "unsafe archive path",
    );

    const linkRoot = await copyEvidence(
      outputRoot,
      join(parent, "link"),
    );
    const linkArchive = join(
      linkRoot,
      "capture-a.tar.gz",
    );
    await writeFile(
      linkArchive,
      maliciousArchive("./link", "2"),
    );
    await updateArchiveReference(linkRoot, linkArchive);
    await expect(verify(linkRoot)).rejects.toThrow(
      "unsupported archive entry",
    );

    const oversizedRoot = await copyEvidence(
      outputRoot,
      join(parent, "oversized"),
    );
    const oversizedArchive = join(
      oversizedRoot,
      "capture-a.tar.gz",
    );
    await writeFile(
      oversizedArchive,
      gzipSync(Buffer.alloc(16 * 1_024 * 1_024 + 512)),
    );
    await updateArchiveReference(
      oversizedRoot,
      oversizedArchive,
    );
    await expect(verify(oversizedRoot)).rejects.toThrow(
      "archive exceeds uncompressed byte limit",
    );

    const receiptRoot = await copyEvidence(
      outputRoot,
      join(parent, "receipt"),
    );
    const receiptManifest = await mutableManifest(receiptRoot);
    receiptManifest.replayReceipt.canonicalJson =
      receiptManifest.replayReceipt.canonicalJson.replace(
        '"liveNetworkExecutionProven": false',
        '"liveNetworkExecutionProven": true',
      );
    receiptManifest.replayReceipt.bytes = Buffer.byteLength(
      receiptManifest.replayReceipt.canonicalJson,
    );
    receiptManifest.replayReceipt.sha256 = sha256(
      receiptManifest.replayReceipt.canonicalJson,
    );
    await writeManifest(receiptRoot, receiptManifest);
    await expect(verify(receiptRoot)).rejects.toThrow();

    const authorityRoot = await copyEvidence(
      outputRoot,
      join(parent, "authority"),
    );
    const authorityManifest =
      await mutableManifest(authorityRoot);
    const authorityBoundary: {
      externalAuthenticityVerified: boolean;
    } = authorityManifest.boundary;
    authorityBoundary.externalAuthenticityVerified = true;
    await writeFile(
      join(authorityRoot, "portable-evidence.json"),
      `${JSON.stringify(authorityManifest, null, 2)}\n`,
    );
    await expect(verify(authorityRoot)).rejects.toThrow();
  }, 60_000);

  it("parses only the seven required materializer options", () => {
    expect(
      parseC6SourceV3SimplePriorIdentityPortableEvidenceCliOptions([
        "--capture-a=/tmp/capture-a",
        "--capture-b=/tmp/capture-b",
        "--output-root=/tmp/portable",
        "--plan=/tmp/plan.json",
        "--protocol=/tmp/protocol.json",
        "--replay-receipt=/tmp/replay.json",
        "--source-universe=/tmp/source.json",
      ]),
    ).toEqual({
      captureA: "/tmp/capture-a",
      captureB: "/tmp/capture-b",
      outputRoot: "/tmp/portable",
      planPath: "/tmp/plan.json",
      protocolPath: "/tmp/protocol.json",
      replayReceiptPath: "/tmp/replay.json",
      sourceUniversePath: "/tmp/source.json",
    });
    expect(() =>
      parseC6SourceV3SimplePriorIdentityPortableEvidenceCliOptions([
        "--capture-a=/tmp/capture-a",
      ])
    ).toThrow("--capture-b is required");
    expect(() =>
      parseC6SourceV3SimplePriorIdentityPortableEvidenceCliOptions([
        "--capture-a=/tmp/capture-a",
        "--capture-a=/tmp/capture-a-2",
      ])
    ).toThrow("--capture-a cannot be specified more than once");
    expect(() =>
      parseC6SourceV3SimplePriorIdentityPortableEvidenceCliOptions([
        "--unknown=value",
      ])
    ).toThrow("unknown C6 source-v3-simple prior identity portable evidence option");
  });
});

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(
    `/private/tmp/goodmemory-c6-source-v3-${label}-`,
  );
  temporaryRoots.push(root);
  return root;
}

async function copyEvidence(
  source: string,
  destination: string,
): Promise<string> {
  await cp(source, destination, { recursive: true });
  return destination;
}

type MutableManifest = ReturnType<
  typeof parseC6SourceV3SimplePriorIdentityPortableEvidenceManifest
>;

async function mutableManifest(
  root: string,
): Promise<MutableManifest> {
  return structuredClone(
    parseC6SourceV3SimplePriorIdentityPortableEvidenceManifest(
      await readFile(
        join(root, "portable-evidence.json"),
      ),
    ),
  ) as MutableManifest;
}

async function writeManifest(
  root: string,
  manifest: MutableManifest,
): Promise<void> {
  await writeFile(
    join(root, "portable-evidence.json"),
    serializeC6SourceV3SimplePriorIdentityPortableEvidenceManifest(
      manifest,
    ),
  );
}

async function updateArchiveReference(
  root: string,
  archivePath: string,
): Promise<void> {
  const manifest = await mutableManifest(root);
  const archive = await readFile(archivePath);
  manifest.archives.captureA.bytes = archive.byteLength;
  manifest.archives.captureA.sha256 = sha256(archive);
  await writeManifest(root, manifest);
}

async function createTar(
  sourceRoot: string,
  outputPath: string,
): Promise<void> {
  await execFileAsync(
    "tar",
    [
      "--no-xattrs",
      "--format=ustar",
      "-czf",
      outputPath,
      "-C",
      sourceRoot,
      ".",
    ],
    {
      env: {
        ...process.env,
        COPYFILE_DISABLE: "1",
      },
    },
  );
}

function maliciousArchive(
  path: string,
  type: "0" | "2",
): Buffer {
  const body = type === "0" ? Buffer.from("x") : Buffer.alloc(0);
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  writeTarOctal(header, 100, 8, 0o600);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, body.byteLength);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  if (type === "2") {
    header.write("target", 157, 100, "utf8");
  }
  header.write("ustar", 257, 5, "ascii");
  header[262] = 0;
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce(
    (sum, byte) => sum + byte,
    0,
  );
  writeTarOctal(header, 148, 8, checksum);
  const paddedBody = Buffer.alloc(
    Math.ceil(body.byteLength / 512) * 512,
  );
  body.copy(paddedBody);
  return gzipSync(Buffer.concat([
    header,
    paddedBody,
    Buffer.alloc(1_024),
  ]));
}

function writeTarOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  const text = value.toString(8).padStart(length - 2, "0");
  target.write(`${text}\0 `, offset, length, "ascii");
}

async function materializeBundle(
  bundleRoot: string,
  requestIdPrefix: string,
): Promise<string> {
  await mkdir(bundleRoot);
  const rawEvidenceRoot = join(bundleRoot, "raw-evidence");
  let requestIndex = 0;
  const plan = parseC6Wave3PriorRepositoryIdentityPlan(
    await readFile(PLAN_PATH),
  );
  const draft =
    await captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence({
      authorizationToken: TOKEN,
      outputRoot: rawEvidenceRoot,
      planPath: PLAN_PATH,
      protocolPath: PROTOCOL_PATH,
      sleep: async () => undefined,
      sourceUniversePath: SOURCE_PATH,
      transport: async (request) => {
        requestIndex += 1;
        const body = await request.json() as {
          variables: {
            name: string;
            owner: string;
          };
        };
        const nameWithOwner =
          `${body.variables.owner}/${body.variables.name}`;
        return successResponse({
          nameWithOwner,
          repositoryNodeId:
            `R_${nameWithOwner.replace("/", "_")}`,
          requestId:
            `${requestIdPrefix}${requestIndex}:1234`,
        });
      },
    });
  const structure =
    await buildC6SourceV3SimplePriorRepositoryIdentityStructure({
      assetRoot: rawEvidenceRoot,
      lookups: draft.lookups,
      plan,
      planPath: PLAN_PATH,
      protocolPath: PROTOCOL_PATH,
      sourceUniversePath: SOURCE_PATH,
    });
  await writeFile(
    join(
      bundleRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
    ),
    serializeC6SourceV3SimplePriorRepositoryIdentityStructure(
      structure,
    ),
  );
  await writeFile(
    join(bundleRoot, "asset-lock.json"),
    serializeC6AssetLock(
      await buildC6AssetLock(bundleRoot),
    ),
  );
  return bundleRoot;
}

function successResponse(input: {
  nameWithOwner: string;
  repositoryNodeId: string;
  requestId: string;
}): Response {
  return new Response(JSON.stringify({
    data: {
      rateLimit: {
        cost: 1,
        limit: 5_000,
        remaining: 4_000,
        resetAt: RESET_AT,
        used: 1_000,
      },
      repository: {
        id: input.repositoryNodeId,
        nameWithOwner: input.nameWithOwner,
        url: `https://github.com/${input.nameWithOwner}`,
      },
    },
  }), {
    headers: {
      date: "Sat, 25 Jul 2026 12:00:00 GMT",
      "x-github-request-id": input.requestId,
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4000",
      "x-ratelimit-reset": RESET_EPOCH,
      "x-ratelimit-resource": "graphql",
      "x-ratelimit-used": "1000",
    },
    status: 200,
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
