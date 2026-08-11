import { readFileSync } from "node:fs";

import { describe, expect, it } from "bun:test";

import { buildGoodMemoryCapabilityDescriptor } from "../../src/api/capabilityDescriptor";

const STATIC_DESCRIPTOR_URL = new URL(
  "../../.well-known/goodmemory.json",
  import.meta.url,
);
const PACKAGE_JSON_URL = new URL("../../package.json", import.meta.url);

function readPackageJson(): {
  version: string;
  bin: Record<string, string>;
  goodmemoryRelease: { status: "release-candidate" | "stable" };
} {
  return JSON.parse(readFileSync(PACKAGE_JSON_URL, "utf8")) as {
    version: string;
    bin: Record<string, string>;
    goodmemoryRelease: { status: "release-candidate" | "stable" };
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
      npmDistTag: "latest",
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

  it("loads a current LoCoMo claim only for stable from the fixed tracked projection", () => {
    const descriptor = buildGoodMemoryCapabilityDescriptor();
    const { goodmemoryRelease, version } = readPackageJson();
    if (goodmemoryRelease.status === "release-candidate") {
      expect(descriptor.benchmarks.currentClaims).toEqual([]);
    } else {
      expect(descriptor.benchmarks.currentClaims).toEqual([
        expect.objectContaining({
          measuredPackageVersion: version,
          name: "LoCoMo",
        }),
      ]);
    }
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
      goodmemoryRelease.status === "release-candidate"
        ? "None is a current 0.7.3 production claim"
        : "The current LoCoMo claim is loaded only from",
    );
    expect(descriptor.canonicalSources.note).toContain(
      "never relabels historical results",
    );
  });

  it("fails closed when 0.7.3 is marked stable without its tracked claim projection", () => {
    const projection = new URL(
      "../../benchmark-claims/evidence/locomo-v0.7.3-current.json",
      import.meta.url,
    );
    if (readFileSync(PACKAGE_JSON_URL, "utf8").includes('"status": "stable"')) {
      expect(() => buildGoodMemoryCapabilityDescriptor()).not.toThrow();
      return;
    }
    expect(() => buildGoodMemoryCapabilityDescriptor({
      packageMetadata: {
        goodmemoryRelease: {
          installCommandsApplyAfterPublish: true,
          npmDistTag: "latest",
          status: "stable",
        },
        version: "0.7.3",
      },
    })).toThrow(projection.pathname);
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
