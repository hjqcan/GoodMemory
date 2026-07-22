import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const RELEASE_VERSION = "0.7.0";
const RC_README = `> **Release status:** this branch is the \`0.7.0\` release candidate. npm
> \`latest\` remains \`0.6.0\` until the tagged stable workflow publishes 0.7.0.
> The version-pinned registry commands below are the post-publish contract; use
> the locally packed \`goodmemory-0.7.0.tgz\` for pre-publish verification.`;
const STABLE_README = `> **Release source:** this is the immutable \`0.7.0\` stable release source.
> Registry commands require \`goodmemory@0.7.0\` to be published. The release
> workflow verifies npm \`latest\` and artifact integrity before creating the
> GitHub Release.`;
const RC_README_ZH = `> **发布状态：**当前分支是 \`0.7.0\` release candidate；在带 tag 的稳定发布
> workflow 真正发布 0.7.0 之前，npm \`latest\` 仍是 \`0.6.0\`。下文锁定
> 0.7.0 的 registry 命令是发布后的契约；发布前请使用本地打包的
> \`goodmemory-0.7.0.tgz\` 验证。`;
const STABLE_README_ZH = `> **发布源码：**这是不可变的 \`0.7.0\` 稳定发布源码。Registry 命令要求
> \`goodmemory@0.7.0\` 已发布；release workflow 会先校验 npm \`latest\`
> 与制品完整性，再创建 GitHub Release。`;
const RC_LLMS = `Release status: this source tree targets the 0.7.0 release candidate. npm
latest remains 0.6.0 until the tagged stable workflow publishes 0.7.0. The
version-pinned registry commands below apply after publication; pre-publish
verification uses goodmemory-0.7.0.tgz.`;
const STABLE_LLMS = `Release source: this is the immutable GoodMemory 0.7.0 stable release source.
Registry commands require goodmemory@0.7.0 to be published. The release workflow
verifies npm latest and artifact integrity before creating the GitHub Release.`;

export const V07_STABLE_RELEASE_METADATA = {
  installCommandsApplyAfterPublish: true,
  npmDistTag: "latest",
  status: "stable",
} as const;

interface PackageJson {
  goodmemoryRelease?: unknown;
  name?: unknown;
  version?: unknown;
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

function assertStableReleaseMetadata(value: unknown, label: string): void {
  const release = value as Partial<typeof V07_STABLE_RELEASE_METADATA> | undefined;
  if (
    release?.installCommandsApplyAfterPublish !== true ||
    release.npmDistTag !== "latest" ||
    release.status !== "stable" ||
    Object.hasOwn(release, "npmLatest")
  ) {
    throw new Error(`${label} does not describe immutable stable 0.7.0 source.`);
  }
}

export async function assertV07StableReleaseSource(input: {
  repoRoot: string;
}): Promise<void> {
  const repoRoot = resolve(input.repoRoot);
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  ) as PackageJson;
  if (packageJson.name !== "goodmemory" || packageJson.version !== RELEASE_VERSION) {
    throw new Error("Stable release source must be goodmemory@0.7.0.");
  }
  assertStableReleaseMetadata(packageJson.goodmemoryRelease, "package.json");

  const descriptor = JSON.parse(
    await readFile(join(repoRoot, ".well-known/goodmemory.json"), "utf8"),
  ) as { releaseStatus?: unknown; version?: unknown };
  if (descriptor.version !== RELEASE_VERSION) {
    throw new Error("Stable capability descriptor version must be 0.7.0.");
  }
  const releaseStatus = descriptor.releaseStatus as
    | { tarball?: unknown }
    | undefined;
  assertStableReleaseMetadata(
    releaseStatus,
    ".well-known/goodmemory.json",
  );
  if (releaseStatus?.tarball !== `goodmemory-${RELEASE_VERSION}.tgz`) {
    throw new Error(
      `Stable capability descriptor must name goodmemory-${RELEASE_VERSION}.tgz.`,
    );
  }

  const proseMarkers = {
    "README.md": "immutable `0.7.0` stable release source",
    "README.zh-CN.md": "不可变的 `0.7.0` 稳定发布源码",
    "llms.txt": "immutable GoodMemory 0.7.0 stable release source",
  } as const;
  for (const [path, marker] of Object.entries(proseMarkers)) {
    const header = (await readFile(join(repoRoot, path), "utf8")).slice(0, 1_000);
    if (!header.includes(marker) || /release candidate/iu.test(header)) {
      throw new Error(`${path} does not describe the stable release source.`);
    }
  }
}

export async function promoteV07ReleaseSource(input: {
  repoRoot: string;
}): Promise<void> {
  const repoRoot = resolve(input.repoRoot);
  const packagePath = join(repoRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as PackageJson;
  if (packageJson.name !== "goodmemory" || packageJson.version !== RELEASE_VERSION) {
    throw new Error("Release promotion source must be goodmemory@0.7.0.");
  }
  packageJson.goodmemoryRelease = V07_STABLE_RELEASE_METADATA;
  const packageOutput = `${JSON.stringify(packageJson, null, 2)}\n`;

  const descriptorPath = join(repoRoot, ".well-known/goodmemory.json");
  const descriptor = JSON.parse(
    await readFile(descriptorPath, "utf8"),
  ) as Record<string, unknown>;
  if (descriptor.version !== RELEASE_VERSION) {
    throw new Error("Release promotion capability descriptor must be 0.7.0.");
  }
  descriptor.releaseStatus = {
    ...V07_STABLE_RELEASE_METADATA,
    tarball: `goodmemory-${RELEASE_VERSION}.tgz`,
  };
  const descriptorOutput = `${JSON.stringify(descriptor, null, 2)}\n`;

  const prose = [
    ["README.md", RC_README, STABLE_README],
    ["README.zh-CN.md", RC_README_ZH, STABLE_README_ZH],
    ["llms.txt", RC_LLMS, STABLE_LLMS],
  ] as const;
  const proseOutputs = await Promise.all(prose.map(async ([path, expected, replacement]) => {
    const absolutePath = join(repoRoot, path);
    const content = await readFile(absolutePath, "utf8");
    return [
      absolutePath,
      replaceExact(content, expected, replacement, path),
    ] as const;
  }));

  await writeFile(packagePath, packageOutput, "utf8");
  await writeFile(descriptorPath, descriptorOutput, "utf8");
  await Promise.all(
    proseOutputs.map(([path, content]) => writeFile(path, content, "utf8")),
  );
  await assertV07StableReleaseSource({ repoRoot });
}

if (import.meta.main) {
  await promoteV07ReleaseSource({ repoRoot: process.cwd() });
  process.stdout.write("Promoted source metadata to the stable 0.7.0 release contract.\n");
}
