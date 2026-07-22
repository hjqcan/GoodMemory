import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  verifyC3RunnerSourceReproducibility,
} from "../../scripts/codex-coding-effect/c3-source-reproducibility";

describe("Codex coding-effect C3 runner source reproducibility", () => {
  it("replays the projection from the exact runner commit recovered from a bundle", async () => {
    const fixture = await createFixture();
    try {
      const result = await verifyC3RunnerSourceReproducibility({
        evidenceDirectory: fixture.evidenceDirectory,
      });

      expect(result.verification).toMatchObject({
        decision: "accepted",
        evidenceClass: "frozen-prehistory-pilot",
        externalAuthenticityVerified: false,
        projectionManifestSha256: fixture.projectionManifestSha256,
        reasons: [],
        replayedArmCount: 2,
        runId: "c3-source-fixture",
        runnerCommit: fixture.runnerCommit,
        runnerSourceReproducible: true,
        runnerTree: fixture.runnerTree,
        schemaVersion: 1,
        verificationScope:
          "bundled-recorded-runner-clean-clone-and-projection-replay",
      });
      expect(result.replayedVerificationBytes).not.toBeNull();
      if (result.replayedVerificationBytes === null) {
        throw new Error("expected replayed C3 verification bytes");
      }
      expect(result.verification.replayedVerificationSha256).toBe(
        sha256(result.replayedVerificationBytes),
      );
    } finally {
      await rm(fixture.root, { recursive: true });
    }
  });

  it("rejects a bundle whose bytes no longer match the frozen input manifest", async () => {
    const fixture = await createFixture();
    try {
      const bundlePath = join(
        fixture.evidenceDirectory,
        "runner-source.bundle",
      );
      const bundle = await readFile(bundlePath);
      bundle[bundle.length - 1] = (bundle[bundle.length - 1] ?? 0) ^ 0xff;
      await writeFile(bundlePath, bundle);

      const result = await verifyC3RunnerSourceReproducibility({
        evidenceDirectory: fixture.evidenceDirectory,
      });

      expect(result.verification).toMatchObject({
        decision: "rejected",
        reasons: ["C3 runner source bundle does not match the manifest"],
        runnerSourceReproducible: false,
      });
      expect(result.replayedVerificationBytes).toBeNull();
    } finally {
      await rm(fixture.root, { recursive: true });
    }
  });

  it("rejects a self-declared runner identity that disagrees with the frozen run", async () => {
    const fixture = await createFixture();
    try {
      const manifestPath = join(fixture.evidenceDirectory, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        runnerSource: { commit: string };
      };
      manifest.runnerSource.commit = "f".repeat(40);
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );

      const result = await verifyC3RunnerSourceReproducibility({
        evidenceDirectory: fixture.evidenceDirectory,
      });

      expect(result.verification).toMatchObject({
        decision: "rejected",
        reasons: ["C3 source manifest does not match the projection"],
        runnerSourceReproducible: false,
      });
      expect(result.replayedVerificationBytes).toBeNull();
    } finally {
      await rm(fixture.root, { recursive: true });
    }
  });
});

async function createFixture(): Promise<{
  evidenceDirectory: string;
  projectionManifestSha256: string;
  root: string;
  runnerCommit: string;
  runnerTree: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-c3-source-"));
  const phaseRoot = join(root, "phase-73");
  const projectionDirectory = join(phaseRoot, "c3-source-fixture");
  const evidenceDirectory = join(
    phaseRoot,
    "c3-source-fixture-source-reproducibility",
  );
  const runnerRepository = join(root, "runner");
  await Promise.all([
    mkdir(projectionDirectory, { recursive: true }),
    mkdir(evidenceDirectory, { recursive: true }),
    mkdir(join(runnerRepository, "scripts"), { recursive: true }),
  ]);
  await writeFile(
    join(runnerRepository, "scripts", "verify-codex-coding-effect-c3-evidence.ts"),
    fakeVerifierSource,
    "utf8",
  );
  await run(["git", "init", "--quiet"], runnerRepository);
  await run(["git", "config", "user.email", "c3-fixture@example.test"], runnerRepository);
  await run(["git", "config", "user.name", "C3 Fixture"], runnerRepository);
  await run(["git", "checkout", "--quiet", "-b", "c3-snapshot-003"], runnerRepository);
  await run(["git", "add", "."], runnerRepository);
  await run(["git", "commit", "--quiet", "-m", "C3 runner fixture"], runnerRepository, {
    GIT_AUTHOR_DATE: "2026-07-16T18:57:37Z",
    GIT_COMMITTER_DATE: "2026-07-16T18:57:37Z",
  });
  const runnerCommit = (await run([
    "git",
    "rev-parse",
    "HEAD",
  ], runnerRepository)).trim();
  const runnerTree = (await run([
    "git",
    "rev-parse",
    "HEAD^{tree}",
  ], runnerRepository)).trim();
  const projectionManifestBytes = `${JSON.stringify({
    evidenceClass: "frozen-prehistory-pilot",
    runId: "c3-source-fixture",
    schemaVersion: 1,
  }, null, 2)}\n`;
  const projectionManifestSha256 = sha256(projectionManifestBytes);
  await Promise.all([
    writeFile(
      join(projectionDirectory, "projection-manifest.json"),
      projectionManifestBytes,
      "utf8",
    ),
    writeFile(
      join(projectionDirectory, "run-identity.json"),
      `${JSON.stringify({
        evidenceClass: "frozen-prehistory-pilot",
        runId: "c3-source-fixture",
        runnerSource: {
          commit: runnerCommit,
          tree: runnerTree,
        },
      }, null, 2)}\n`,
      "utf8",
    ),
  ]);
  const bundlePath = join(evidenceDirectory, "runner-source.bundle");
  await run([
    "git",
    "bundle",
    "create",
    bundlePath,
    "c3-snapshot-003",
  ], runnerRepository);
  const bundle = await readFile(bundlePath);
  await writeFile(
    join(evidenceDirectory, "manifest.json"),
    `${JSON.stringify({
      bundle: {
        bytes: bundle.byteLength,
        path: "runner-source.bundle",
        ref: "refs/heads/c3-snapshot-003",
        sha256: sha256(bundle),
      },
      evidenceClass: "frozen-prehistory-pilot",
      projectionDirectory: "c3-source-fixture",
      projectionManifestSha256,
      runId: "c3-source-fixture",
      runnerSource: {
        commit: runnerCommit,
        tree: runnerTree,
      },
      schemaVersion: 1,
    }, null, 2)}\n`,
    "utf8",
  );
  return {
    evidenceDirectory,
    projectionManifestSha256,
    root,
    runnerCommit,
    runnerTree,
  };
}

async function run(
  command: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<string> {
  const process = Bun.spawn(command, {
    cwd,
    env: { ...Bun.env, ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  }
  return stdout;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const fakeVerifierSource = `
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const projectionDirectory = args.get("--projection-directory");
const output = args.get("--output");
const manifestBytes = await readFile(
  join(projectionDirectory, "projection-manifest.json"),
  "utf8",
);
const manifest = JSON.parse(manifestBytes);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const verification = {
  decision: "accepted",
  evidenceClass: "frozen-prehistory-pilot",
  externalAuthenticityVerified: false,
  projectionManifestSha256: sha256(manifestBytes),
  reasons: [],
  replayedArmCount: 2,
  runId: manifest.runId,
  schemaVersion: 1,
  verificationScope: "internal-consistency-and-clean-clone-patch-replay",
  verifiedFileCount: 17,
};
await writeFile(output, JSON.stringify(verification, null, 2) + "\\n", "utf8");
process.stdout.write(JSON.stringify(verification, null, 2) + "\\n");
`;
