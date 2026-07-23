import { execFile } from "node:child_process";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const PHASE74_CONFIRMATORY_PLAN_REMOTE = "origin";
const PHASE74_CONFIRMATORY_PLAN_REMOTE_REF = "refs/heads/main";
const PHASE74_CONFIRMATORY_PLAN_REMOTE_URL =
  "https://github.com/hjqcan/GoodMemory.git";

const execFileAsync = promisify(execFile);

export interface Phase74ConfirmatoryPlanGitAnchor {
  readonly [key: string]: string;
  commit: string;
  executionCommit: string;
  path: string;
  remote: "origin";
  remoteRef: "refs/heads/main";
  remoteUrl: "https://github.com/hjqcan/GoodMemory.git";
}

export interface Phase74ConfirmatoryPlanGitAnchorDependencies {
  isAncestor(
    repoRoot: string,
    ancestorCommit: string,
    descendantCommit: string,
  ): Promise<boolean>;
  readGitBlob(
    repoRoot: string,
    revision: string,
    relativePath: string,
  ): Promise<string>;
  resolveGitHead(repoRoot: string): Promise<string>;
  resolvePlanCommit(
    repoRoot: string,
    relativePath: string,
  ): Promise<string>;
  resolveRemoteRef(
    repoRoot: string,
    remote: string,
    remoteRef: string,
  ): Promise<string>;
}

async function resolveGitHead(repoRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return stdout.trim().toLowerCase();
}

async function resolvePlanCommit(
  repoRoot: string,
  relativePath: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["log", "-1", "--format=%H", "--", relativePath],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return stdout.trim().toLowerCase();
}

async function readGitBlob(
  repoRoot: string,
  revision: string,
  relativePath: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["show", `${revision}:${relativePath}`],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return stdout;
}

async function isAncestor(
  repoRoot: string,
  ancestorCommit: string,
  descendantCommit: string,
): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["merge-base", "--is-ancestor", ancestorCommit, descendantCommit],
      { cwd: repoRoot, encoding: "utf8" },
    );
    return true;
  } catch {
    return false;
  }
}

async function resolveRemoteRef(
  repoRoot: string,
  remote: string,
  remoteRef: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-remote", "--exit-code", remote, remoteRef],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  const rows = stdout.trim().split("\n").filter(Boolean);
  const match = rows.find((row) => row.split(/\s+/u)[1] === remoteRef);
  return match?.split(/\s+/u)[0]?.toLowerCase() ?? "";
}

const DEFAULT_DEPENDENCIES: Phase74ConfirmatoryPlanGitAnchorDependencies = {
  isAncestor,
  readGitBlob,
  resolveGitHead,
  resolvePlanCommit,
  resolveRemoteRef,
};

function relativePlanPath(repoRoot: string, planPath: string): string {
  const root = resolve(repoRoot);
  const plan = resolve(planPath);
  const relativePath = relative(root, plan);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      "Phase 74 confirmatory plan must be inside the repository.",
    );
  }
  return relativePath.split(sep).join("/");
}

function commit(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!COMMIT_PATTERN.test(normalized)) {
    throw new Error(`Phase 74 ${label} did not resolve to a Git commit.`);
  }
  return normalized;
}

export async function verifyPhase74ConfirmatoryPlanGitAnchor(input: {
  dependencies?: Phase74ConfirmatoryPlanGitAnchorDependencies;
  planContent: string;
  planPath: string;
  repoRoot: string;
}): Promise<Phase74ConfirmatoryPlanGitAnchor> {
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES;
  const path = relativePlanPath(input.repoRoot, input.planPath);
  const [headValue, anchorValue] = await Promise.all([
    dependencies.resolveGitHead(input.repoRoot),
    dependencies.resolvePlanCommit(input.repoRoot, path),
  ]);
  const head = commit(headValue, "checkout HEAD");
  const anchorCommit = commit(anchorValue, "confirmatory plan anchor");
  const [headBlob, anchorBlob, ancestor, remoteCommitValue] = await Promise.all([
    dependencies.readGitBlob(input.repoRoot, head, path),
    dependencies.readGitBlob(input.repoRoot, anchorCommit, path),
    dependencies.isAncestor(input.repoRoot, anchorCommit, head),
    dependencies.resolveRemoteRef(
      input.repoRoot,
      PHASE74_CONFIRMATORY_PLAN_REMOTE_URL,
      PHASE74_CONFIRMATORY_PLAN_REMOTE_REF,
    ),
  ]);
  if (headBlob !== input.planContent || anchorBlob !== input.planContent) {
    throw new Error(
      "Phase 74 confirmatory plan bytes drifted from the tracked Git blob.",
    );
  }
  if (!ancestor) {
    throw new Error(
      "Phase 74 confirmatory plan anchor is not an ancestor of the execution history.",
    );
  }
  const remoteCommit = commit(
    remoteCommitValue,
    "origin/main remote receipt",
  );
  if (remoteCommit !== anchorCommit) {
    throw new Error(
      "Phase 74 confirmatory plan lacks an exact origin/main pre-run remote receipt.",
    );
  }
  return {
    commit: anchorCommit,
    executionCommit: head,
    path,
    remote: PHASE74_CONFIRMATORY_PLAN_REMOTE,
    remoteRef: PHASE74_CONFIRMATORY_PLAN_REMOTE_REF,
    remoteUrl: PHASE74_CONFIRMATORY_PLAN_REMOTE_URL,
  };
}

export async function verifyRecordedPhase74ConfirmatoryPlanGitAnchor(input: {
  anchor: Phase74ConfirmatoryPlanGitAnchor;
  dependencies?: Phase74ConfirmatoryPlanGitAnchorDependencies;
  planContent: string;
  repoRoot: string;
}): Promise<Phase74ConfirmatoryPlanGitAnchor> {
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES;
  if (
    input.anchor.remote !== PHASE74_CONFIRMATORY_PLAN_REMOTE ||
    input.anchor.remoteRef !== PHASE74_CONFIRMATORY_PLAN_REMOTE_REF ||
    input.anchor.remoteUrl !== PHASE74_CONFIRMATORY_PLAN_REMOTE_URL
  ) {
    throw new Error(
      "Phase 74 confirmatory plan remote receipt descriptor drifted.",
    );
  }
  const path = relativePlanPath(
    input.repoRoot,
    resolve(input.repoRoot, input.anchor.path),
  );
  if (path !== input.anchor.path) {
    throw new Error(
      "Phase 74 confirmatory plan Git anchor path is not canonical.",
    );
  }
  const anchorCommit = commit(
    input.anchor.commit,
    "recorded confirmatory plan anchor",
  );
  const executionCommit = commit(
    input.anchor.executionCommit,
    "recorded confirmatory execution",
  );
  const [headValue, remoteCommitValue] = await Promise.all([
    dependencies.resolveGitHead(input.repoRoot),
    dependencies.resolveRemoteRef(
      input.repoRoot,
      PHASE74_CONFIRMATORY_PLAN_REMOTE_URL,
      PHASE74_CONFIRMATORY_PLAN_REMOTE_REF,
    ),
  ]);
  const head = commit(headValue, "checkout HEAD");
  const remoteCommit = commit(
    remoteCommitValue,
    "recorded origin/main remote receipt",
  );
  const [
    executionBlob,
    anchorBlob,
    anchorInExecutionHistory,
    executionInCurrentHistory,
    anchorInRemoteHistory,
    executionInRemoteHistory,
  ] = await Promise.all([
    dependencies.readGitBlob(input.repoRoot, executionCommit, path),
    dependencies.readGitBlob(input.repoRoot, anchorCommit, path),
    dependencies.isAncestor(
      input.repoRoot,
      anchorCommit,
      executionCommit,
    ),
    dependencies.isAncestor(input.repoRoot, executionCommit, head),
    dependencies.isAncestor(
      input.repoRoot,
      anchorCommit,
      remoteCommit,
    ),
    dependencies.isAncestor(
      input.repoRoot,
      executionCommit,
      remoteCommit,
    ),
  ]);
  if (
    executionBlob !== input.planContent ||
    anchorBlob !== input.planContent
  ) {
    throw new Error(
      "Phase 74 recorded confirmatory plan bytes drifted from Git.",
    );
  }
  if (!anchorInExecutionHistory || !executionInCurrentHistory) {
    throw new Error(
      "Phase 74 recorded confirmatory plan anchor is not in the execution history.",
    );
  }
  if (!anchorInRemoteHistory || !executionInRemoteHistory) {
    throw new Error(
      "Phase 74 recorded confirmatory plan anchor or execution commit is absent from the fixed remote history.",
    );
  }
  return {
    commit: anchorCommit,
    executionCommit,
    path,
    remote: PHASE74_CONFIRMATORY_PLAN_REMOTE,
    remoteRef: PHASE74_CONFIRMATORY_PLAN_REMOTE_REF,
    remoteUrl: PHASE74_CONFIRMATORY_PLAN_REMOTE_URL,
  };
}
