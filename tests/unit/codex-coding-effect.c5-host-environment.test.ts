import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  buildC3HostConfigurationEvidence,
} from "../../scripts/codex-coding-effect/c3-host-configuration";
import {
  hashC5ComparableHostEnvironment,
  parseC5HostEnvironment,
  projectC5ComparableHostEnvironment,
} from "../../scripts/codex-coding-effect/c5-host-environment";

describe("Codex coding-effect C5 comparable host environment", () => {
  it("ignores cluster-local receipts but binds normalized configuration semantics", () => {
    const first = hostEnvironment({ receipt: "cluster-1" });
    const receiptDrift = hostEnvironment({ receipt: "cluster-2" });
    const semanticDrift = hostEnvironment({
      goodmemoryConfigText: '{"writebackMode":"disabled"}',
      receipt: "cluster-2",
    });

    expect(hashC5ComparableHostEnvironment(first)).toBe(
      hashC5ComparableHostEnvironment(receiptDrift),
    );
    expect(hashC5ComparableHostEnvironment(semanticDrift)).not.toBe(
      hashC5ComparableHostEnvironment(first),
    );
  });

  it("rejects a normalized diff that was not derived from the frozen arms", () => {
    const environment = hostEnvironment({ receipt: "cluster-1" });

    expect(() => parseC5HostEnvironment({
      ...environment,
      configurations: {
        ...environment.configurations,
        normalizedDiff: [{
          goodmemoryInstalled: "disabled",
          noMemory: null,
          path: "goodmemoryConfig.normalizedText",
        }],
      },
    })).toThrow("normalized host configuration diff is inconsistent");
  });

  it("keeps raw configuration receipts out of the comparable projection", () => {
    const environment = hostEnvironment({ receipt: "cluster-1" });
    const projection = JSON.stringify(
      projectC5ComparableHostEnvironment(environment),
    );

    expect(projection).not.toContain(environment.goodmemory.configSha256);
    expect(projection).not.toContain(environment.goodmemory.hooksSha256);
    expect(projection).toContain('"writebackMode":"selective"');
  });
});

function hostEnvironment(input: {
  goodmemoryConfigText?: string;
  receipt: string;
}) {
  const installedConfigSha256 = sha256(`${input.receipt}:installed-config`);
  const noMemoryConfigSha256 = sha256(`${input.receipt}:no-memory-config`);
  const goodmemoryConfigSha256 = sha256(`${input.receipt}:goodmemory-config`);
  const hooksConfigSha256 = sha256(`${input.receipt}:hooks-config`);
  const configurations = buildC3HostConfigurationEvidence({
    goodmemoryInstalled: {
      codexConfig: {
        normalizedText: "features.hooks=true",
        sourceSha256: installedConfigSha256,
      },
      environment: controlledEnvironment(),
      goodmemoryConfig: {
        normalizedText:
          input.goodmemoryConfigText ?? '{"writebackMode":"selective"}',
        sourceSha256: goodmemoryConfigSha256,
      },
      hooksConfig: {
        normalizedText: '{"hooks":["SessionStart","Stop"]}',
        sourceSha256: hooksConfigSha256,
      },
      profile: installedProfile(),
    },
    noMemory: {
      codexConfig: {
        normalizedText: "features.hooks=false",
        sourceSha256: noMemoryConfigSha256,
      },
      environment: controlledEnvironment(),
      goodmemoryConfig: null,
      hooksConfig: null,
      profile: null,
    },
  });

  return parseC5HostEnvironment({
    codexFeatures: {
      goodmemoryInstalled: featureEvidence(true),
      noMemory: featureEvidence(false),
    },
    configurations,
    goodmemory: {
      configSha256: goodmemoryConfigSha256,
      executableSha256: sha256("goodmemory-executable"),
      hooksSha256: hooksConfigSha256,
      mcpExecutableSha256: sha256("goodmemory-mcp"),
      packageSha256: sha256("goodmemory-package"),
    },
    platform: {
      arch: "arm64",
      cpuCount: 8,
      name: "darwin",
      totalMemoryBytes: 16_000_000_000,
    },
    repositoryPolicy: {
      dirtyStatePolicy: "reject",
      workspaceIsolation: "fresh-isolated-clone-per-stage",
    },
    toolchain: Object.fromEntries(
      ["bun", "git", "node", "npm", "python"].map((name) => [
        name,
        { sha256: sha256(`${name}-executable`), version: `${name}-test` },
      ]),
    ),
  });
}

function controlledEnvironment(): Record<string, string> {
  return {
    CODEX_HOME: "<codex-home>",
    GOODMEMORY_HOME: "<home>/.goodmemory",
    HOME: "<home>",
    PATH: "<package-prefix>/bin:<host-path>",
    TMPDIR: "<temp>",
  };
}

function featureEvidence(hooksEnabled: boolean) {
  const rawOutput = `hooks stable ${hooksEnabled}\nmemories stable false\n`;
  return {
    hooks: { enabled: hooksEnabled, maturity: "stable" },
    memories: { enabled: false, maturity: "stable" },
    outputSha256: sha256(rawOutput),
    rawOutput,
  };
}

function installedProfile() {
  return {
    activationMode: "global",
    hookRegistered: true,
    mcpRegistered: true,
    persistRawTranscript: false,
    retrievalProfile: "coding_agent",
    workspaceStatus: "ok",
    writebackMode: "selective",
  } as const;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
