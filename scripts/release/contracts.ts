export type ReleaseCheckStatus = "fail" | "pass" | "skip";

export type ReleaseStatus = "release-candidate" | "stable";

export interface ReleaseArtifactRef {
  bytes: number;
  id: string;
  integrity?: string;
  kind: "file" | "tarball" | "tree";
  path: string;
  sha256: string;
  tracked: boolean;
}

export interface ReleaseCheck {
  detail: string;
  durationMs: number;
  evidenceArtifactIds: string[];
  id: string;
  required: boolean;
  status: ReleaseCheckStatus;
  title: string;
}

export interface ReleaseCommandCheck {
  args: readonly ReleaseCommandArgument[];
  command: string;
  generatedEvidence?: {
    id: string;
    path: string;
  };
  id: string;
  required: boolean;
  requiredEnvironment?: string;
  successDetail: string;
  title: string;
}

export type ReleaseCommandArgument = string | { outputPath: string };

export interface ReleaseEvidenceInput {
  checkId: string;
  id: string;
  kind: "file" | "tree";
  path: string;
  sha256: string;
  title: string;
}

export interface ReleasePackageIdentity {
  distTag: string;
  installCommandsApplyAfterPublish: boolean;
  name: string;
  status: ReleaseStatus;
  tarballName: string;
  version: string;
}

export interface ReleaseArtifactPolicy {
  consumerSmoke: string;
  maxTarballBytes: number;
  requiredFiles: readonly string[];
}

export interface ReleaseRuntimePolicy {
  bun: string;
  node: string;
}

export interface ReleaseProfile {
  artifact: ReleaseArtifactPolicy;
  checks: readonly ReleaseCommandCheck[];
  evidenceInputs: readonly ReleaseEvidenceInput[];
  id: string;
  package: ReleasePackageIdentity;
  runtime: ReleaseRuntimePolicy;
}

export interface ReleaseRuntimeIdentity {
  bunVersion: string;
  nodeVersion: string;
}

export interface ReleaseSourceIdentity {
  clean: boolean;
  commit: string;
  tag: string | null;
  tree: string;
}

export interface ReleaseManifestV1 {
  allRequiredPassed: boolean;
  artifacts: ReleaseArtifactRef[];
  checks: ReleaseCheck[];
  package: ReleasePackageIdentity;
  profileId: string;
  runtime: ReleaseRuntimeIdentity;
  schemaVersion: "goodmemory.release-manifest.v1";
  source: ReleaseSourceIdentity;
  summary: {
    failed: number;
    passed: number;
    skipped: number;
    total: number;
  };
}

export interface ReleaseCommandOutcome {
  code: number | null;
  durationMs: number;
  stderr: string;
  stdout: string;
}

export interface ReleasePreparedArtifact {
  artifactRef: ReleaseArtifactRef;
  consumerCheck: ReleaseCheck;
  packCheck: ReleaseCheck;
  path: string;
}

export interface ReleaseRunResult {
  archivePath: string;
  manifest: ReleaseManifestV1;
  manifestPath: string;
  summaryPath: string;
  tarballPath?: string;
}
