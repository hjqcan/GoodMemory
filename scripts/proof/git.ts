import { execFile } from "node:child_process";
import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const objectIdPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

export interface GitSourceIdentity {
  commit: string;
  tree: string;
}

export async function resolveGitSourceIdentity(
  repositoryRoot: string,
): Promise<GitSourceIdentity> {
  const environment = cleanGitEnvironment(process.env);
  const commit = await gitRevParse(repositoryRoot, "HEAD", environment);
  const tree = await gitRevParse(
    repositoryRoot,
    `${commit}^{tree}`,
    environment,
  );
  return { commit, tree };
}

export async function resolveCleanGitSourceIdentity(
  repositoryRoot: string,
): Promise<GitSourceIdentity> {
  const environment = cleanGitEnvironment(process.env);
  const { stdout } = await execFileAsync(
    "git",
    [
      "-C",
      repositoryRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ],
    {
      encoding: "utf8",
      env: environment,
    },
  );
  if (stdout.length !== 0) {
    throw new Error("proof execution requires a clean Git worktree");
  }
  return resolveGitSourceIdentity(repositoryRoot);
}

export async function verifyGitSourceAnchor(
  repositoryRoot: string,
  expected: GitSourceIdentity,
): Promise<void> {
  const environment = cleanGitEnvironment(process.env);
  const tree = await gitRevParse(
    repositoryRoot,
    `${expected.commit}^{tree}`,
    environment,
  );
  if (tree !== expected.tree) {
    throw new Error("Git source anchor mismatch");
  }
}

export async function withGitSourceCheckout<T>(
  repositoryRoot: string,
  expected: GitSourceIdentity,
  run: (checkoutRoot: string) => Promise<T>,
): Promise<T> {
  await verifyGitSourceAnchor(repositoryRoot, expected);
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "goodmemory-proof-source-"),
  );
  const checkoutRoot = join(temporaryRoot, "repository");
  try {
    const environment = cleanGitEnvironment(process.env);
    await execFileAsync(
      "git",
      [
        "clone",
        "--quiet",
        "--no-local",
        "--no-checkout",
        repositoryRoot,
        checkoutRoot,
      ],
      { env: environment },
    );
    await execFileAsync(
      "git",
      [
        "-C",
        checkoutRoot,
        "checkout",
        "--quiet",
        "--detach",
        expected.commit,
      ],
      { env: environment },
    );
    const observed = await resolveCleanGitSourceIdentity(checkoutRoot);
    if (
      observed.commit !== expected.commit ||
      observed.tree !== expected.tree
    ) {
      throw new Error("bound Git source checkout mismatch");
    }
    return await run(checkoutRoot);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

export async function verifyGitSourceStability(
  repositoryRoot: string,
  expected: GitSourceIdentity,
): Promise<void> {
  const observed = await resolveCleanGitSourceIdentity(repositoryRoot);
  if (
    observed.commit !== expected.commit ||
    observed.tree !== expected.tree
  ) {
    throw new Error("proof execution source changed");
  }
}

async function gitRevParse(
  repositoryRoot: string,
  revision: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryRoot, "rev-parse", "--verify", revision],
    {
      encoding: "utf8",
      env,
    },
  );
  const objectId = stdout.trim();
  if (!objectIdPattern.test(objectId)) {
    throw new Error(`invalid Git object identity ${JSON.stringify(objectId)}`);
  }
  return objectId;
}

function cleanGitEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.startsWith("GIT_")),
  );
}
