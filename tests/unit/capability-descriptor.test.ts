import { readFileSync } from "node:fs";

import { describe, expect, it } from "bun:test";

import { buildGoodMemoryCapabilityDescriptor } from "../../src/api/capabilityDescriptor";

const STATIC_DESCRIPTOR_URL = new URL(
  "../../.well-known/goodmemory.json",
  import.meta.url,
);
const PACKAGE_JSON_URL = new URL("../../package.json", import.meta.url);

function readPackageJson(): { version: string; bin: Record<string, string> } {
  return JSON.parse(readFileSync(PACKAGE_JSON_URL, "utf8")) as {
    version: string;
    bin: Record<string, string>;
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
    const { version } = readPackageJson();
    const descriptor = buildGoodMemoryCapabilityDescriptor();
    expect(descriptor.version).toBe(version);
    expect(descriptor.releaseStatus).toEqual({
      installCommandsApplyAfterPublish: true,
      npmLatest: "0.6.0",
      status: "release-candidate",
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
          installCommandsApplyAfterPublish: false,
          npmLatest: "0.7.0",
          status: "stable",
        },
        version: "0.7.0",
      },
    });

    expect(descriptor.releaseStatus).toEqual({
      installCommandsApplyAfterPublish: false,
      npmLatest: "0.7.0",
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

  it("does not promote v0.6 benchmark evidence as a current v0.7 claim", () => {
    const descriptor = buildGoodMemoryCapabilityDescriptor();
    expect(descriptor.benchmarks.currentClaims).toEqual([]);
    expect(descriptor.benchmarks.historicalEvidence.url).toBe(
      "https://github.com/hjqcan/GoodMemory/tree/main/benchmark-claims",
    );
    expect(descriptor.benchmarks.historicalEvidence.note).toContain(
      "v0.6.0",
    );
    expect(descriptor.benchmarks.historicalEvidence.note).toContain(
      "LoCoMo, BEAM, and MemoryAgentBench",
    );
    expect(descriptor.benchmarks.historicalEvidence.note).toContain(
      "None is a current 0.7.0 production claim",
    );
    expect(descriptor.canonicalSources.note).toContain(
      "never relabels historical results",
    );
  });

  it("names three onboarding paths with distinct delivery methods", () => {
    const descriptor = buildGoodMemoryCapabilityDescriptor();
    expect(descriptor.onboarding.map((path) => path.method)).toEqual([
      "cli",
      "mcp",
      "http",
    ]);
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
