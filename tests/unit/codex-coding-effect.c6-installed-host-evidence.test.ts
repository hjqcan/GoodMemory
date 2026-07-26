import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  C6_INSTALLED_HOST_INJECTION_EVENT_METADATA_POLICY,
  C6_INSTALLED_HOST_INJECTION_PLACEMENT,
  computeC6InstalledHostInjectionEventMetadataSha256,
  computeC6InstalledHostRunnerIdentitySha256,
  verifyC6InstalledHostEvidence,
  verifyC6InstalledHostEvidenceStructure,
} from "../../scripts/codex-coding-effect/c6-installed-host-evidence";
import type {
  C6InstalledHostCapturedHookEvent,
  C6InstalledHostEvidence,
  C6InstalledHostReceiptBytes,
} from "../../scripts/codex-coding-effect/c6-installed-host-evidence";
import {
  countC6InjectedTokens,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
} from "../../scripts/codex-coding-effect/c6-flat-summary";

const repositoryRoot = resolve(import.meta.dir, "../..");
const receiptPaths = {
  codex: resolve(
    repositoryRoot,
    "fixtures/codex-coding-effect/c6-codex-runtime-linux-materialization/receipt.json",
  ),
  package: resolve(
    repositoryRoot,
    "fixtures/codex-coding-effect/c6-package-runtime/goodmemory-0.7.0-linux-x64-materialization/linux-rebuild-receipt.json",
  ),
  source: resolve(
    repositoryRoot,
    "fixtures/codex-coding-effect/c6-package-runtime/goodmemory-0.7.0-source-rebuild/receipt.json",
  ),
} as const;

describe("Codex coding-effect C6 installed-host evidence", () => {
  it("cross-binds the retained receipts and hook captures as structural-only evidence", async () => {
    const fixture = await buildFixture();

    expect(verifyStructureFixture(fixture)).toEqual({
      codexLinuxOfflineInstallProven: false,
      codexRunReady: false,
      currentSourceRunnerBound: false,
      executionAuthenticated: false,
      externalIndependentAttestation: false,
      finalCompositionBytesBound: false,
      flatSummaryPlacementParityProven: false,
      hostIdentityDeclarationsStructurallyConsistent: true,
      injectionEventMetadataStructurallyBound: true,
      installedHostProfileProven: false,
      packageLinuxRebuildProven: false,
      rawExecutionWitnessIncluded: false,
      receiptSetSha256: fixture.evidence.host.receiptSetSha256,
      receiptRelationshipsStructurallyConsistent: true,
      runnerReceiptRelationshipsStructurallyConsistent: true,
      sourceBuildReproducible: false,
    });
  });

  it("fails closed against the default current runner because the retained v2 receipt is stale", async () => {
    const fixture = await buildFixture();

    await expect(verifyC6InstalledHostEvidence({
      evidence: fixture.evidence,
      receiptBytes: fixture.receiptBytes,
      runnerSourceBytes: fixture.runnerSourceBytes,
    })).rejects.toThrow("current source runner closure");
  });

  it("rejects receipt substitution and cross-receipt package or runtime drift", async () => {
    const fixture = await buildFixture();
    expect(() => verifyC6InstalledHostEvidenceStructure({
      evidence: fixture.evidence,
      receiptBytes: {
        ...fixture.receiptBytes,
        package: Buffer.concat([
          Buffer.from(fixture.receiptBytes.package),
          Buffer.from(" "),
        ]),
      },
      runnerSourceBytes: fixture.runnerSourceBytes,
    })).toThrow("package receipt hash");

    const sourceReceipt = parseSourceReceipt(
      fixture.receiptBytes.source,
    );
    sourceReceipt.runs[1].output.sha256 = sha256("other-package");
    const packageDrift = rebindReceiptBytes(fixture, {
      ...fixture.receiptBytes,
      source: JSON.stringify(sourceReceipt),
    });
    expect(() => verifyStructureFixture(packageDrift)).toThrow(
      "package identity",
    );

    const codexReceipt = parseCodexReceipt(fixture.receiptBytes.codex);
    codexReceipt.inputIdentity.runtimeIdentitySha256 =
      sha256("other-runtime");
    const runtimeDrift = rebindReceiptBytes(fixture, {
      ...fixture.receiptBytes,
      codex: JSON.stringify(codexReceipt),
    });
    expect(() => verifyStructureFixture(runtimeDrift)).toThrow(
      "Codex runtime identity",
    );
  });

  it("hash-binds runner source bytes and every ordered hook capture field", async () => {
    const fixture = await buildFixture();
    expect(() => verifyC6InstalledHostEvidenceStructure({
      evidence: fixture.evidence,
      receiptBytes: fixture.receiptBytes,
      runnerSourceBytes: `${fixture.runnerSourceBytes}\nmutated`,
    })).toThrow("runner source bytes hash");

    const mutations: Array<(evidence: C6InstalledHostEvidence) => void> = [
      (evidence) => {
        evidence.injection.events[0]!.hostIdentity.homeIdentitySha256 =
          sha256("other-home");
      },
      (evidence) => {
        evidence.injection.events.reverse();
      },
      (evidence) => {
        evidence.injection.events[0]!.rawHookOutput = hookOutput(
          "SessionStart",
          "mutated context",
        );
      },
      (evidence) => {
        evidence.injection.events[0]!.injectedTokenCount += 1;
      },
      (evidence) => {
        evidence.injection.events[0]!.maxTokens -= 1;
      },
      (evidence) => {
        const event = evidence.injection.events[0] as {
          placement: string;
        };
        event.placement = "prompt-prefix";
      },
      (evidence) => {
        evidence.injection.eventMetadataSha256 =
          sha256("other-event-metadata");
      },
    ];
    for (const mutate of mutations) {
      const evidence = structuredClone(fixture.evidence);
      mutate(evidence);
      expect(() => verifyC6InstalledHostEvidenceStructure({
        evidence,
        receiptBytes: fixture.receiptBytes,
        runnerSourceBytes: fixture.runnerSourceBytes,
      })).toThrow();
    }
  });

  it("cannot promote structural aggregation to host proof or Codex readiness", async () => {
    const fixture = await buildFixture();
    const evidence = structuredClone(fixture.evidence) as unknown as {
      boundary: Record<string, boolean>;
    };
    evidence.boundary.codexRunReady = true;
    evidence.boundary.executionAuthenticated = true;
    evidence.boundary.installedHostProfileProven = true;

    expect(() => verifyC6InstalledHostEvidenceStructure({
      evidence,
      receiptBytes: fixture.receiptBytes,
      runnerSourceBytes: fixture.runnerSourceBytes,
    })).toThrow();
  });
});

interface SourceReceiptFixture {
  runs: [
    { output: { packageVersion: string; sha256: string } },
    { output: { packageVersion: string; sha256: string } },
  ];
}

interface PackageReceiptFixture {
  input: {
    packageSha256: string;
    packageVersion: string;
  };
}

interface CodexReceiptFixture {
  inputIdentity: {
    imageSha256: string;
    linuxTarballSha256: string;
    mainTarballSha256: string;
    runtimeIdentitySha256: string;
    version: string;
  };
}

type Fixture = Awaited<ReturnType<typeof buildFixture>>;

async function buildFixture() {
  const [codex, packageReceiptBytes, source] = await Promise.all([
    readFile(receiptPaths.codex),
    readFile(receiptPaths.package),
    readFile(receiptPaths.source),
  ]);
  const receiptBytes: C6InstalledHostReceiptBytes = {
    codex,
    package: packageReceiptBytes,
    source,
  };
  const packageReceipt = parsePackageReceipt(packageReceiptBytes);
  const codexReceipt = parseCodexReceipt(codex);
  const receipts = {
    codex: { sha256: sha256(codex) },
    package: { sha256: sha256(packageReceiptBytes) },
    source: { sha256: sha256(source) },
  };
  const hostIdentity = {
    codexHomeIdentitySha256: sha256("isolated-codex-home"),
    homeIdentitySha256: sha256("isolated-home"),
  };
  const receiptSet = receiptSetSha256(receipts);
  const runnerSourceBytes =
    "c6 installed-host structural aggregation runner fixture";
  const runnerSourceBytesSha256 = sha256(runnerSourceBytes);
  const runnerIdentitySha256 = computeC6InstalledHostRunnerIdentitySha256({
    ...hostIdentity,
    receiptSetSha256: receiptSet,
    runnerSourceBytesSha256,
  });
  const eventIdentity = {
    ...hostIdentity,
    runnerIdentitySha256,
  };
  const eventInputs = [
    {
      context: "Session memory context",
      hookEventName: "SessionStart" as const,
      maxTokens: 128,
    },
    {
      context: "Prompt memory context",
      hookEventName: "UserPromptSubmit" as const,
      maxTokens: 64,
    },
  ];
  const events: C6InstalledHostCapturedHookEvent[] = eventInputs.map(
    (event, sequence) => {
      const rawHookOutput = hookOutput(
        event.hookEventName,
        event.context,
      );
      return {
        additionalContextSha256: sha256(event.context),
        hookEventName: event.hookEventName,
        hostIdentity: { ...eventIdentity },
        injectedTokenCount: countC6InjectedTokens(event.context),
        maxTokens: event.maxTokens,
        placement: C6_INSTALLED_HOST_INJECTION_PLACEMENT,
        rawHookOutput,
        rawHookOutputSha256: sha256(rawHookOutput),
        sequence,
      };
    },
  );
  const evidence = {
    boundary: {
      codexLinuxOfflineInstallProven: false,
      codexRunReady: false,
      executionAuthenticated: false,
      externalIndependentAttestation: false,
      installedHostProfileProven: false,
      packageLinuxRebuildProven: false,
      rawExecutionWitnessIncluded: false,
      sourceBuildReproducible: false,
    },
    host: {
      codex: {
        linuxTarballSha256:
          codexReceipt.inputIdentity.linuxTarballSha256,
        mainTarballSha256:
          codexReceipt.inputIdentity.mainTarballSha256,
        runtimeIdentitySha256:
          codexReceipt.inputIdentity.runtimeIdentitySha256,
        version: codexReceipt.inputIdentity.version,
      },
      config: {
        maxTokens: 64,
        sessionStartMaxTokens: 128,
      },
      declaredIsolation: {
        codexHomeIsolated: true,
        homeAndCodexHomeDistinct: true,
        homeIsolated: true,
      },
      goodmemory: {
        packageSha256: packageReceipt.input.packageSha256,
        version: packageReceipt.input.packageVersion,
      },
      identity: hostIdentity,
      platform: {
        architecture: "x86_64",
        imageSha256: codexReceipt.inputIdentity.imageSha256,
        operatingSystem: "linux",
      },
      receiptSetSha256: receiptSet,
      runner: {
        identitySha256: runnerIdentitySha256,
        sourceBytesSha256: runnerSourceBytesSha256,
      },
    },
    injection: {
      eventMetadataPolicy:
        C6_INSTALLED_HOST_INJECTION_EVENT_METADATA_POLICY,
      eventMetadataSha256:
        computeC6InstalledHostInjectionEventMetadataSha256({
          events,
          hostIdentity: eventIdentity,
          tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
          tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
        }),
      events,
      tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
      tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    },
    kind: "c6-installed-host-evidence",
    receipts,
    schemaVersion: 1,
  } satisfies C6InstalledHostEvidence;

  return {
    evidence,
    receiptBytes,
    runnerSourceBytes,
  };
}

function rebindReceiptBytes(
  fixture: Fixture,
  receiptBytes: C6InstalledHostReceiptBytes,
): Fixture {
  const evidence = structuredClone(fixture.evidence);
  evidence.receipts = {
    codex: { sha256: sha256(receiptBytes.codex) },
    package: { sha256: sha256(receiptBytes.package) },
    source: { sha256: sha256(receiptBytes.source) },
  };
  evidence.host.receiptSetSha256 = receiptSetSha256(evidence.receipts);
  evidence.host.runner.identitySha256 =
    computeC6InstalledHostRunnerIdentitySha256({
      ...evidence.host.identity,
      receiptSetSha256: evidence.host.receiptSetSha256,
      runnerSourceBytesSha256:
        evidence.host.runner.sourceBytesSha256,
    });
  for (const event of evidence.injection.events) {
    event.hostIdentity.runnerIdentitySha256 =
      evidence.host.runner.identitySha256;
  }
  evidence.injection.eventMetadataSha256 =
    computeC6InstalledHostInjectionEventMetadataSha256({
      events: evidence.injection.events,
      hostIdentity: {
        ...evidence.host.identity,
        runnerIdentitySha256: evidence.host.runner.identitySha256,
      },
      tokenCounterId: evidence.injection.tokenCounterId,
      tokenCounterSha256: evidence.injection.tokenCounterSha256,
    });
  return {
    ...fixture,
    evidence,
    receiptBytes,
  };
}

function verifyStructureFixture(fixture: Fixture) {
  return verifyC6InstalledHostEvidenceStructure({
    evidence: fixture.evidence,
    receiptBytes: fixture.receiptBytes,
    runnerSourceBytes: fixture.runnerSourceBytes,
  });
}

function parseSourceReceipt(
  bytes: string | Uint8Array,
): SourceReceiptFixture {
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as
    SourceReceiptFixture;
}

function parsePackageReceipt(
  bytes: string | Uint8Array,
): PackageReceiptFixture {
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as
    PackageReceiptFixture;
}

function parseCodexReceipt(
  bytes: string | Uint8Array,
): CodexReceiptFixture {
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as
    CodexReceiptFixture;
}

function hookOutput(
  hookEventName: "SessionStart" | "UserPromptSubmit",
  additionalContext: string,
): string {
  return JSON.stringify({
    hookSpecificOutput: {
      additionalContext,
      hookEventName,
    },
  });
}

function receiptSetSha256(
  receipts: {
    codex: { sha256: string };
    package: { sha256: string };
    source: { sha256: string };
  },
): string {
  return sha256(JSON.stringify({
    codex: receipts.codex.sha256,
    package: receipts.package.sha256,
    source: receipts.source.sha256,
  }));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
