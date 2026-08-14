import { readFileSync } from "node:fs";

import { describe, expect, it } from "bun:test";

import {
  BENCHMARK_EVIDENCE_BOUNDARY_NOTE,
  buildGoodMemoryCapabilityDescriptor,
} from "../../src/api/capabilityDescriptor";

const STATIC_DESCRIPTOR_URL = new URL(
  "../../.well-known/goodmemory.json",
  import.meta.url,
);
const PACKAGE_JSON_URL = new URL("../../package.json", import.meta.url);

function readPackageJson(): {
  version: string;
  bin: Record<string, string>;
  goodmemoryRelease: {
    npmDistTag: "latest" | "next";
    status: "release-candidate" | "stable";
  };
} {
  return JSON.parse(readFileSync(PACKAGE_JSON_URL, "utf8")) as {
    version: string;
    bin: Record<string, string>;
    goodmemoryRelease: {
      npmDistTag: "latest" | "next";
      status: "release-candidate" | "stable";
    };
  };
}

describe("GoodMemory capability descriptor", () => {
  it("keeps the committed .well-known/goodmemory.json in sync with the builder", () => {
    const generated = `${JSON.stringify(
      buildGoodMemoryCapabilityDescriptor(),
      null,
      2,
    )}\n`;
    const committed = readFileSync(STATIC_DESCRIPTOR_URL, "utf8");
    // Regenerate with: bun run scripts/generate-capability-descriptor.ts
    expect(committed).toBe(generated);
  });

  it("reports the package version and derives version-pinned install commands", () => {
    const { goodmemoryRelease, version } = readPackageJson();
    const descriptor = buildGoodMemoryCapabilityDescriptor();
    expect(descriptor.version).toBe(version);
    expect(descriptor.releaseStatus).toEqual({
      installCommandsApplyAfterPublish: true,
      npmDistTag: goodmemoryRelease.npmDistTag,
      status: goodmemoryRelease.status,
      tarball: `goodmemory-${version}.tgz`,
    });
    expect(descriptor.install.npmGlobal).toBe(
      `npm install -g goodmemory@${version}`,
    );
    expect(descriptor.install.bun).toBe(`bun add goodmemory@${version}`);
    expect(descriptor.onboarding[0]?.steps?.[0]).toBe(
      `npm install -g goodmemory@${version}`,
    );
  });

  it("derives stable runtime metadata from the staged package manifest", () => {
    const descriptor = buildGoodMemoryCapabilityDescriptor({
      packageMetadata: {
        goodmemoryRelease: {
          installCommandsApplyAfterPublish: true,
          npmDistTag: "latest",
          status: "stable",
        },
        version: "0.7.0",
      },
    });

    expect(descriptor.releaseStatus).toEqual({
      installCommandsApplyAfterPublish: true,
      npmDistTag: "latest",
      status: "stable",
      tarball: "goodmemory-0.7.0.tgz",
    });
  });

  it("advertises the MCP command that the package bin actually exposes", () => {
    const { bin } = readPackageJson();
    const descriptor = buildGoodMemoryCapabilityDescriptor();
    expect(bin[descriptor.mcp.command]).toBeDefined();
    expect(descriptor.mcp.standaloneArgs).toContain("--standalone");
    expect(descriptor.mcp.primaryTools).toEqual([
      "goodmemory_get_context",
      "goodmemory_remember",
    ]);
  });

  it("keeps all unreceipted benchmark measurements internal", () => {
    const descriptor = buildGoodMemoryCapabilityDescriptor();
    expect(descriptor.benchmarks.currentClaims).toEqual([]);
    expect(descriptor.benchmarks.historicalEvidence.url).toBe(
      "https://github.com/hjqcan/GoodMemory/tree/main/benchmark-claims",
    );
    expect(descriptor.benchmarks.historicalEvidence.note).toBe(
      BENCHMARK_EVIDENCE_BOUNDARY_NOTE,
    );
    expect(descriptor.canonicalSources.note).toContain(
      "never relabels historical results",
    );
  });

  it("does not relabel the v0.7.3 projection as a current v0.7.4 stable claim", () => {
    expect(buildGoodMemoryCapabilityDescriptor({
      packageMetadata: {
        goodmemoryRelease: {
          installCommandsApplyAfterPublish: true,
          npmDistTag: "latest",
          status: "stable",
        },
        version: "0.7.4",
      },
    }).benchmarks.currentClaims).toEqual([]);
  });

  it("names four onboarding paths including the Kimi Code plugin", () => {
    const descriptor = buildGoodMemoryCapabilityDescriptor();
    expect(descriptor.onboarding.map((path) => path.method)).toEqual([
      "cli",
      "plugin",
      "mcp",
      "http",
    ]);
    expect(descriptor.onboarding[1]).toMatchObject({
      audience: "kimi-code-plugin",
      install: "/plugins install https://github.com/hjqcan/GoodMemory",
      runtimeRequirements: ["Node.js >=20", "Bun >=1.3.14", "npx"],
    });
    expect(descriptor.kind).toBe("memory-layer");
    expect(descriptor.notA).toContain("agent-framework");
  });

  it("publishes the complete first-class LanguagePack set", () => {
    const descriptor = buildGoodMemoryCapabilityDescriptor();

    expect(descriptor.capabilities.builtInLanguagePacks).toEqual([
      "en",
      "zh-Hans",
      "zh-Hant",
      "ja",
      "ko",
      "fr",
      "es",
    ]);
  });

  it("honors an injected version without touching the filesystem", () => {
    const descriptor = buildGoodMemoryCapabilityDescriptor({
      version: "9.9.9",
    });
    expect(descriptor.version).toBe("9.9.9");
    expect(descriptor.install.npmPackage).toBe("npm install goodmemory@9.9.9");
  });
});
