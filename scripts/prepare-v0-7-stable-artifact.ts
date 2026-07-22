import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_VERSION = "0.7.0";
const RC_README = `> **Release status:** this branch is the \`0.7.0\` release candidate. npm
> \`latest\` remains \`0.6.0\` until the tagged stable workflow publishes 0.7.0.
> The version-pinned registry commands below are the post-publish contract; use
> the locally packed \`goodmemory-0.7.0.tgz\` for pre-publish verification.`;
const STABLE_README = `> **Release status:** \`0.7.0\` is the current stable release; npm \`latest\` points to \`0.7.0\`.
> The version-pinned registry commands below
> target the published stable package.`;
const RC_README_ZH = `> **发布状态：**当前分支是 \`0.7.0\` release candidate；在带 tag 的稳定发布
> workflow 真正发布 0.7.0 之前，npm \`latest\` 仍是 \`0.6.0\`。下文锁定
> 0.7.0 的 registry 命令是发布后的契约；发布前请使用本地打包的
> \`goodmemory-0.7.0.tgz\` 验证。`;
const STABLE_README_ZH = `> **发布状态：**\`0.7.0\` 是当前稳定版本；npm \`latest\` 指向 \`0.7.0\`。
> 下文锁定版本的 registry 命令均对应已发布的稳定包。`;
const RC_LLMS = `Release status: this source tree targets the 0.7.0 release candidate. npm
latest remains 0.6.0 until the tagged stable workflow publishes 0.7.0. The
version-pinned registry commands below apply after publication; pre-publish
verification uses goodmemory-0.7.0.tgz.`;
const STABLE_LLMS = `Release status: GoodMemory 0.7.0 is the current stable release; npm latest points to 0.7.0.
The version-pinned registry commands below target the
published stable package.`;
const STABLE_RELEASE = {
  installCommandsApplyAfterPublish: false,
  npmLatest: RELEASE_VERSION,
  status: "stable",
} as const;

export interface V07StableArtifact {
  artifactName: string;
  artifactPath: string;
  integrity: string;
  version: string;
}

interface PackageJson {
  goodmemoryRelease?: unknown;
  name?: unknown;
  version?: unknown;
}

async function runCommand(input: {
  cmd: string[];
  cwd: string;
}): Promise<string> {
  const child = Bun.spawn({
    cmd: input.cmd,
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
    throw new Error(
      `${input.cmd.join(" ")} failed with exit ${exitCode}: ${stderr.trim()}`,
    );
  }
  return stdout.trim();
}

async function extractTarball(
  tarballPath: string,
  outputDir: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  await runCommand({
    cmd: ["tar", "-xzf", tarballPath, "-C", outputDir],
    cwd: outputDir,
  });
  return join(outputDir, "package");
}

function replaceExact(
  content: string,
  expected: string,
  replacement: string,
  path: string,
): string {
  const first = content.indexOf(expected);
  if (first < 0 || content.indexOf(expected, first + expected.length) >= 0) {
    throw new Error(`Expected exactly one v0.7 RC status block in ${path}.`);
  }
  return `${content.slice(0, first)}${replacement}${content.slice(first + expected.length)}`;
}

async function projectStableMetadata(packageRoot: string): Promise<void> {
  const packagePath = join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as PackageJson;
  if (packageJson.name !== "goodmemory" || packageJson.version !== RELEASE_VERSION) {
    throw new Error("Stable artifact source must be goodmemory@0.7.0.");
  }
  packageJson.goodmemoryRelease = STABLE_RELEASE;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  const prose = [
    ["README.md", RC_README, STABLE_README],
    ["README.zh-CN.md", RC_README_ZH, STABLE_README_ZH],
    ["llms.txt", RC_LLMS, STABLE_LLMS],
  ] as const;
  await Promise.all(prose.map(async ([path, expected, replacement]) => {
    const absolutePath = join(packageRoot, path);
    const content = await readFile(absolutePath, "utf8");
    await writeFile(
      absolutePath,
      replaceExact(content, expected, replacement, path),
      "utf8",
    );
  }));

  const descriptorPath = join(packageRoot, ".well-known/goodmemory.json");
  const descriptor = JSON.parse(
    await readFile(descriptorPath, "utf8"),
  ) as Record<string, unknown>;
  if (descriptor.version !== RELEASE_VERSION) {
    throw new Error("Stable capability descriptor version must be 0.7.0.");
  }
  descriptor.releaseStatus = {
    ...STABLE_RELEASE,
    tarball: `goodmemory-${RELEASE_VERSION}.tgz`,
  };
  await writeFile(
    descriptorPath,
    `${JSON.stringify(descriptor, null, 2)}\n`,
    "utf8",
  );
}

function assertStableReleaseStatus(value: unknown, label: string): void {
  const status = value as Partial<typeof STABLE_RELEASE> | undefined;
  if (
    status?.installCommandsApplyAfterPublish !== false ||
    status.npmLatest !== RELEASE_VERSION ||
    status.status !== "stable"
  ) {
    throw new Error(`${label} does not describe the stable 0.7.0 release.`);
  }
}

async function verifyStableTarball(input: {
  packageRoot: string;
  verifyRuntimeDescriptor: boolean;
}): Promise<void> {
  const packageJson = JSON.parse(
    await readFile(join(input.packageRoot, "package.json"), "utf8"),
  ) as PackageJson;
  assertStableReleaseStatus(packageJson.goodmemoryRelease, "package.json");

  const descriptor = JSON.parse(
    await readFile(
      join(input.packageRoot, ".well-known/goodmemory.json"),
      "utf8",
    ),
  ) as { releaseStatus?: unknown };
  assertStableReleaseStatus(
    descriptor.releaseStatus,
    ".well-known/goodmemory.json",
  );

  const proseMarkers = {
    "README.md": [
      "`0.7.0` is the current stable release",
      "npm `latest` points to `0.7.0`",
    ],
    "README.zh-CN.md": [
      "`0.7.0` 是当前稳定版本",
      "npm `latest` 指向 `0.7.0`",
    ],
    "llms.txt": [
      "GoodMemory 0.7.0 is the current stable release",
      "npm latest points to 0.7.0",
    ],
  } as const;
  for (const [path, markers] of Object.entries(proseMarkers)) {
    const content = await readFile(join(input.packageRoot, path), "utf8");
    const releaseHeader = content.slice(0, 1_000);
    if (
      markers.some((marker) => !releaseHeader.includes(marker)) ||
      /release candidate|latest[^\n]{0,80}0\.6\.0/iu.test(releaseHeader)
    ) {
      throw new Error(`${path} still contains pre-publish release metadata.`);
    }
  }

  if (!input.verifyRuntimeDescriptor) {
    return;
  }
  const httpModule = await import(
    `${pathToFileURL(join(input.packageRoot, "dist/http/index.js")).href}?stable-check=${Date.now()}`
  ) as {
    createGoodMemoryHttpMemoryBridge(input: { memory: unknown }): {
      fetch(request: Request): Promise<Response>;
    };
  };
  const bridge = httpModule.createGoodMemoryHttpMemoryBridge({ memory: {} });
  const response = await bridge.fetch(
    new Request("http://localhost/.well-known/goodmemory.json"),
  );
  const runtimeDescriptor = await response.json() as { releaseStatus?: unknown };
  assertStableReleaseStatus(
    runtimeDescriptor.releaseStatus,
    "installed runtime capability descriptor",
  );
}

export async function prepareV07StableArtifact(input: {
  outputDir: string;
  repoRoot: string;
  verifyRuntimeDescriptor?: boolean;
}): Promise<V07StableArtifact> {
  const repoRoot = resolve(input.repoRoot);
  const outputDir = resolve(input.outputDir);
  await mkdir(outputDir, { recursive: true });
  const stagingRoot = await mkdtemp(join(outputDir, ".v0-7-stable-"));
  try {
    const rcOutput = join(stagingRoot, "rc");
    await mkdir(rcOutput, { recursive: true });
    const packed = await runCommand({
      cmd: ["bun", "pm", "pack", "--destination", rcOutput, "--quiet"],
      cwd: repoRoot,
    });
    const rcTarball = join(rcOutput, basename(packed.split("\n").at(-1) ?? ""));
    const stagedPackage = await extractTarball(
      rcTarball,
      join(stagingRoot, "staged"),
    );
    await projectStableMetadata(stagedPackage);

    const npmOutput = await runCommand({
      cmd: [
        "npm",
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        outputDir,
      ],
      cwd: stagedPackage,
    });
    const npmResult = JSON.parse(npmOutput) as Array<{ filename?: unknown }>;
    const artifactName = npmResult[0]?.filename;
    if (typeof artifactName !== "string" || artifactName.length === 0) {
      throw new Error("npm pack did not return a stable artifact filename.");
    }
    const artifactPath = join(outputDir, basename(artifactName));
    const verifiedPackage = await extractTarball(
      artifactPath,
      join(stagingRoot, "verified"),
    );
    await verifyStableTarball({
      packageRoot: verifiedPackage,
      verifyRuntimeDescriptor: input.verifyRuntimeDescriptor ?? true,
    });
    const integrity = `sha512-${createHash("sha512")
      .update(await readFile(artifactPath))
      .digest("base64")}`;
    return {
      artifactName: basename(artifactPath),
      artifactPath,
      integrity,
      version: RELEASE_VERSION,
    };
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  const outputFlag = Bun.argv.indexOf("--output-dir");
  const outputDir = outputFlag >= 0 ? Bun.argv[outputFlag + 1] : undefined;
  if (!outputDir) {
    throw new Error("Usage: bun run scripts/prepare-v0-7-stable-artifact.ts --output-dir <dir>");
  }
  console.log(JSON.stringify(await prepareV07StableArtifact({
    outputDir,
    repoRoot: process.cwd(),
  })));
}
