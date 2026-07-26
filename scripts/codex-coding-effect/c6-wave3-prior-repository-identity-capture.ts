import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

export type C6Wave3PriorRepositoryIdentityTransport = (
  request: Request,
) => Promise<Response>;

export interface C6Wave3PriorRepositoryIdentityCompletionCapability {
  readonly kind:
    "c6-wave3-prior-repository-identity-runner-completion";
}

export interface C6Wave3PriorRepositoryIdentityClosureIdentity {
  assetLockSha256: string;
  assetRootSha256: string;
}

export interface C6Wave3PriorRepositoryIdentityRunnerInput {
  authorizationToken: string;
  planPath: string;
  sourceUniversePath: string;
  temporaryParent?: string;
  transport: C6Wave3PriorRepositoryIdentityTransport;
}

export function assertC6Wave3PriorRepositoryIdentityCompletionCapability(
  capability: unknown,
  assetRoot: string,
  closureIdentity:
    C6Wave3PriorRepositoryIdentityClosureIdentity,
): void {
  void capability;
  void assetRoot;
  void closureIdentity;
  throw new Error(
    "C6 Wave3 prior repository identity external promotion completion capability is unavailable for source-v2",
  );
}

export async function captureC6Wave3PriorRepositoryIdentity(
  input: C6Wave3PriorRepositoryIdentityRunnerInput,
): Promise<never> {
  const token = requiredToken(input.authorizationToken);
  try {
    const planModule = await import(
      "./c6-wave3-prior-repository-identity-plan"
    );
    const planPath = await assertC6NoSymlinkPathComponents(
      input.planPath,
      "C6 Wave3 prior repository identity capture plan",
    );
    const planBytes = await readC6StableRegularFile(
      planPath,
      "Wave3 prior repository identity capture plan",
    );
    const plan =
      planModule.parseC6Wave3PriorRepositoryIdentityPlan(
        planBytes,
      );
    return planModule
      .requireC6Wave3PriorRepositoryIdentityCaptureAuthorization(
        plan,
      );
  } catch (error) {
    throw new Error(
      "C6 Wave3 prior repository identity capture authorization failed: " +
      sanitizedError(error, token),
    );
  }
}

function requiredToken(value: string): string {
  if (
    value.length < 16 ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity authorization token is invalid",
    );
  }
  return value;
}

function sanitizedError(error: unknown, token: string): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.split(token).join("[REDACTED]");
}
