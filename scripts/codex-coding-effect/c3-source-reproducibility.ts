import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

const sha1Schema = z.string().regex(/^[a-f0-9]{40}$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceVerificationScope =
  "bundled-recorded-runner-clean-clone-and-projection-replay" as const;

const sourceBundleManifestSchema = z.object({
  bundle: z.object({
    bytes: z.number().int().positive(),
    path: z.literal("runner-source.bundle"),
    ref: z.literal("refs/heads/c3-snapshot-003"),
    sha256: sha256Schema,
  }).strict(),
  evidenceClass: z.literal("frozen-prehistory-pilot"),
  projectionDirectory: z.string().regex(/^[A-Za-z0-9._-]+$/u),
  projectionManifestSha256: sha256Schema,
  runId: z.string().min(1),
  runnerSource: z.object({
    commit: sha1Schema,
    tree: sha1Schema,
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

const projectionManifestIdentitySchema = z.object({
  evidenceClass: z.literal("frozen-prehistory-pilot"),
  runId: z.string().min(1),
}).passthrough();

const runIdentitySourceSchema = z.object({
  evidenceClass: z.literal("frozen-prehistory-pilot"),
  runId: z.string().min(1),
  runnerSource: z.object({
    commit: sha1Schema,
    tree: sha1Schema,
  }).passthrough(),
}).passthrough();

const replayedVerificationSchema = z.object({
  decision: z.literal("accepted"),
  evidenceClass: z.literal("frozen-prehistory-pilot"),
  externalAuthenticityVerified: z.literal(false),
  projectionManifestSha256: sha256Schema,
  reasons: z.array(z.string()).length(0),
  replayedArmCount: z.literal(2),
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
  verificationScope: z.literal(
    "internal-consistency-and-clean-clone-patch-replay",
  ),
  verifiedFileCount: z.number().int().positive(),
}).strict();

export interface C3RunnerSourceReproducibilityVerification {
  bundleBytes: number | null;
  bundleRef: string | null;
  decision: "accepted" | "rejected";
  evidenceClass: "frozen-prehistory-pilot";
  externalAuthenticityVerified: false;
  manifestSha256: string | null;
  projectionManifestSha256: string | null;
  reasons: string[];
  replayedArmCount: number;
  replayedVerificationSha256: string | null;
  runId: string | null;
  runnerBundleSha256: string | null;
  runnerCommit: string | null;
  runnerSourceReproducible: boolean;
  runnerTree: string | null;
  schemaVersion: 1;
  verificationScope: typeof sourceVerificationScope;
  verifiedFileCount: number;
}

export interface C3RunnerSourceReproducibilityResult {
  replayedVerificationBytes: string | null;
  verification: C3RunnerSourceReproducibilityVerification;
}

export async function verifyC3RunnerSourceReproducibility(input: {
  evidenceDirectory: string;
}): Promise<C3RunnerSourceReproducibilityResult> {
  let manifest: z.infer<typeof sourceBundleManifestSchema> | null = null;
  let manifestSha256: string | null = null;
  try {
    const evidenceDirectory = resolve(input.evidenceDirectory);
    await assertRealDirectory(evidenceDirectory, "C3 source evidence directory");
    const manifestBytes = await readRegularFile(
      evidenceDirectory,
      "manifest.json",
    );
    manifestSha256 = sha256(manifestBytes);
    manifest = sourceBundleManifestSchema.parse(JSON.parse(manifestBytes));

    const phaseRoot = dirname(evidenceDirectory);
    const projectionDirectory = join(
      phaseRoot,
      manifest.projectionDirectory,
    );
    await assertRealDirectory(projectionDirectory, "C3 projection directory");
    const projectionManifestBytes = await readRegularFile(
      projectionDirectory,
      "projection-manifest.json",
    );
    const projectionManifest = projectionManifestIdentitySchema.parse(
      JSON.parse(projectionManifestBytes),
    );
    const projectionManifestSha256 = sha256(projectionManifestBytes);
    const identity = runIdentitySourceSchema.parse(JSON.parse(
      await readRegularFile(projectionDirectory, "run-identity.json"),
    ));
    if (
      projectionManifestSha256 !== manifest.projectionManifestSha256 ||
      projectionManifest.runId !== manifest.runId ||
      identity.runId !== manifest.runId ||
      identity.runnerSource.commit !== manifest.runnerSource.commit ||
      identity.runnerSource.tree !== manifest.runnerSource.tree
    ) {
      throw new Error("C3 source manifest does not match the projection");
    }

    const bundlePath = join(evidenceDirectory, manifest.bundle.path);
    const bundleStats = await lstat(bundlePath);
    if (!bundleStats.isFile() || bundleStats.isSymbolicLink()) {
      throw new Error("C3 runner source bundle must be a regular file");
    }
    const bundle = await readFile(bundlePath);
    if (
      bundle.byteLength !== manifest.bundle.bytes ||
      sha256(bundle) !== manifest.bundle.sha256
    ) {
      throw new Error("C3 runner source bundle does not match the manifest");
    }

    await runCommand({
      command: ["git", "bundle", "verify", bundlePath],
      cwd: resolve(import.meta.dir, "../.."),
      failureReason: "C3 runner source bundle is not a complete Git bundle",
    });
    const heads = await runCommand({
      command: ["git", "bundle", "list-heads", bundlePath],
      cwd: phaseRoot,
      failureReason: "C3 runner source bundle heads cannot be read",
    });
    if (
      heads.trim() !==
        `${manifest.runnerSource.commit} ${manifest.bundle.ref}`
    ) {
      throw new Error("C3 runner source bundle head does not match the manifest");
    }

    const replayParent = join(
      resolve(import.meta.dir, "../.."),
      "node_modules/.cache",
    );
    await mkdir(replayParent, { recursive: true });
    const replayRoot = await mkdtemp(join(
      replayParent,
      "goodmemory-c3-source-replay-",
    ));
    try {
      const verifierRoot = join(replayRoot, "verifier");
      await runCommand({
        command: [
          "git",
          "clone",
          "--quiet",
          "--branch",
          basename(manifest.bundle.ref),
          "--single-branch",
          bundlePath,
          verifierRoot,
        ],
        cwd: replayRoot,
        failureReason: "C3 runner source bundle cannot be clean-cloned",
      });
      const [commit, tree, status] = await Promise.all([
        runCommand({
          command: ["git", "rev-parse", "HEAD"],
          cwd: verifierRoot,
          failureReason: "C3 bundled runner commit cannot be resolved",
        }),
        runCommand({
          command: ["git", "rev-parse", "HEAD^{tree}"],
          cwd: verifierRoot,
          failureReason: "C3 bundled runner tree cannot be resolved",
        }),
        runCommand({
          command: ["git", "status", "--porcelain=v1", "--untracked-files=all"],
          cwd: verifierRoot,
          failureReason: "C3 bundled runner cleanliness cannot be checked",
        }),
      ]);
      if (
        commit.trim() !== manifest.runnerSource.commit ||
        tree.trim() !== manifest.runnerSource.tree ||
        status.length !== 0
      ) {
        throw new Error("C3 clean-cloned runner does not match the manifest");
      }

      const verifierPath = join(
        verifierRoot,
        "scripts/verify-codex-coding-effect-c3-evidence.ts",
      );
      const verifierStats = await lstat(verifierPath);
      if (!verifierStats.isFile() || verifierStats.isSymbolicLink()) {
        throw new Error("C3 bundled runner verifier is not a regular file");
      }
      const replayedVerificationPath = join(
        replayRoot,
        "replayed-c3-verification.json",
      );
      const stdout = await runCommand({
        command: [
          process.execPath,
          verifierPath,
          "--projection-directory",
          projectionDirectory,
          "--output",
          replayedVerificationPath,
        ],
        cwd: verifierRoot,
        failureReason: "C3 bundled runner verifier rejected the projection",
      });
      const replayedVerificationBytes = await readFile(
        replayedVerificationPath,
        "utf8",
      );
      const replayedVerification = replayedVerificationSchema.parse(
        JSON.parse(replayedVerificationBytes),
      );
      if (
        stdout !== replayedVerificationBytes ||
        replayedVerification.runId !== manifest.runId ||
        replayedVerification.projectionManifestSha256 !==
          projectionManifestSha256
      ) {
        throw new Error("C3 bundled runner verification output is inconsistent");
      }

      return {
        replayedVerificationBytes,
        verification: {
          bundleBytes: bundle.byteLength,
          bundleRef: manifest.bundle.ref,
          decision: "accepted",
          evidenceClass: "frozen-prehistory-pilot",
          externalAuthenticityVerified: false,
          manifestSha256,
          projectionManifestSha256,
          reasons: [],
          replayedArmCount: replayedVerification.replayedArmCount,
          replayedVerificationSha256: sha256(replayedVerificationBytes),
          runId: manifest.runId,
          runnerBundleSha256: manifest.bundle.sha256,
          runnerCommit: manifest.runnerSource.commit,
          runnerSourceReproducible: true,
          runnerTree: manifest.runnerSource.tree,
          schemaVersion: 1,
          verificationScope: sourceVerificationScope,
          verifiedFileCount: replayedVerification.verifiedFileCount,
        },
      };
    } finally {
      await rm(replayRoot, { recursive: true });
    }
  } catch (error) {
    return {
      replayedVerificationBytes: null,
      verification: {
        bundleBytes: manifest?.bundle.bytes ?? null,
        bundleRef: manifest?.bundle.ref ?? null,
        decision: "rejected",
        evidenceClass: "frozen-prehistory-pilot",
        externalAuthenticityVerified: false,
        manifestSha256,
        projectionManifestSha256:
          manifest?.projectionManifestSha256 ?? null,
        reasons: [normalizeError(error)],
        replayedArmCount: 0,
        replayedVerificationSha256: null,
        runId: manifest?.runId ?? null,
        runnerBundleSha256: manifest?.bundle.sha256 ?? null,
        runnerCommit: manifest?.runnerSource.commit ?? null,
        runnerSourceReproducible: false,
        runnerTree: manifest?.runnerSource.tree ?? null,
        schemaVersion: 1,
        verificationScope: sourceVerificationScope,
        verifiedFileCount: 0,
      },
    };
  }
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
}

async function readRegularFile(root: string, path: string): Promise<string> {
  const filePath = join(root, path);
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`C3 source evidence file must be regular: ${path}`);
  }
  return readFile(filePath, "utf8");
}

async function runCommand(input: {
  command: string[];
  cwd: string;
  failureReason: string;
}): Promise<string> {
  const child = Bun.spawn(input.command, {
    cwd: input.cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    console.error(JSON.stringify({
      command: input.command,
      cwd: input.cwd,
      exitCode,
      stderr: stderr.trim(),
    }));
    throw new Error(input.failureReason);
  }
  return stdout;
}

function normalizeError(error: unknown): string {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return "C3 runner source reproducibility input is invalid";
  }
  return error instanceof Error
    ? error.message
    : "C3 runner source reproducibility verification failed";
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
