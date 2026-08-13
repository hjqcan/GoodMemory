import type { FeedbackKind } from "../domain/records";
import type { BehavioralPolicy } from "./behavioralPolicy";
import type {
  ExperienceModelInfluence,
  ExperienceRecord,
  LearningProposal,
} from "./contracts";
import { createExperienceRecord } from "./contracts";

const TOOL_OUTCOME_METADATA_SCHEMA = "goodmemory.tool_outcome";
const TOOL_OUTCOME_METADATA_VERSION = 1;
const TOOL_OUTCOME_METADATA_PREFIX = "toolOutcome.";

export type BehavioralFirstActionKind = "command" | "tool_call" | "warning";
export type BehavioralOutcomeRetrievalProfile = "coding_agent" | "general_chat";

export interface BehavioralFirstAction {
  args?: string[];
  kind: BehavioralFirstActionKind;
  name: string;
  raw?: string;
}

export interface BehavioralOutcomeObservationResult {
  cue: string;
  evidenceExcerpt?: string;
  failureClass: string;
  firstAction: BehavioralFirstAction;
  modelInfluence: ExperienceModelInfluence;
  outcome?: "failure" | "mixed" | "skipped" | "success";
  retrievalProfile?: BehavioralOutcomeRetrievalProfile;
  saferAlternative?: BehavioralFirstAction;
}

export interface BehavioralOutcomeRecordInput
  extends Omit<BehavioralOutcomeObservationResult, "modelInfluence"> {
  modelInfluence?: ExperienceModelInfluence;
  traceId?: string;
}

export interface CompiledGuidance {
  appliesTo?: string;
  behavioralPolicy?: BehavioralPolicy;
  confidence?: number;
  kind: Exclude<FeedbackKind, "validated_pattern">;
  rule: string;
  why?: string;
}

export interface LearningProposalWithCompiledGuidance extends LearningProposal {
  compiledGuidance?: CompiledGuidance;
}

export interface ParsedToolOutcomeMetadata {
  cue: string;
  failureClass: string;
  firstAction: BehavioralFirstAction;
  retrievalProfile?: BehavioralOutcomeRetrievalProfile;
  saferAlternative?: BehavioralFirstAction;
}

interface BehavioralOutcomeExperienceInput {
  createdAt: string;
  createId: () => string;
  linkedEvidenceIds?: string[];
  scope: {
    agentId?: string;
    sessionId?: string;
    tenantId?: string;
    userId: string;
    workspaceId?: string;
  };
  traceId: string;
}

function normalizeAction(action: BehavioralFirstAction): BehavioralFirstAction {
  return {
    ...action,
    args: action.args && action.args.length > 0 ? [...action.args] : undefined,
    raw: action.raw?.trim() || undefined,
  };
}

export function formatBehavioralFirstAction(
  action: BehavioralFirstAction,
): string {
  if (action.kind === "warning") {
    return action.raw ?? action.name;
  }

  const argsText = action.args && action.args.length > 0
    ? `(${action.args.join(", ")})`
    : "";
  return argsText.length > 0 ? `${action.name}${argsText}` : action.raw ?? action.name;
}

function resolveBehavioralActionIdentity(
  action: BehavioralFirstAction,
): BehavioralFirstAction {
  const normalized = normalizeAction(action);

  if (normalized.args) {
    return {
      kind: normalized.kind,
      name: normalized.name,
      args: normalized.args,
    };
  }

  return {
    kind: normalized.kind,
    name: normalized.name,
    ...(normalized.raw ? { raw: normalized.raw } : {}),
  };
}

export function serializeBehavioralFirstAction(
  action: BehavioralFirstAction,
): string {
  return JSON.stringify(resolveBehavioralActionIdentity(action));
}

export function behavioralFirstActionsEqual(
  left: BehavioralFirstAction | undefined,
  right: BehavioralFirstAction | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return serializeBehavioralFirstAction(left) === serializeBehavioralFirstAction(right);
}

function buildBehavioralOutcomeMetadata(
  result: BehavioralOutcomeObservationResult,
): NonNullable<ExperienceRecord["metadata"]> {
  return {
    [`${TOOL_OUTCOME_METADATA_PREFIX}schema`]: TOOL_OUTCOME_METADATA_SCHEMA,
    [`${TOOL_OUTCOME_METADATA_PREFIX}version`]: TOOL_OUTCOME_METADATA_VERSION,
    [`${TOOL_OUTCOME_METADATA_PREFIX}cue`]: result.cue,
    [`${TOOL_OUTCOME_METADATA_PREFIX}failureClass`]: result.failureClass,
    [`${TOOL_OUTCOME_METADATA_PREFIX}firstAction`]: JSON.stringify(
      normalizeAction(result.firstAction),
    ),
    ...(result.retrievalProfile
      ? {
          [`${TOOL_OUTCOME_METADATA_PREFIX}retrievalProfile`]:
            result.retrievalProfile,
        }
      : {}),
    ...(result.saferAlternative
      ? {
          [`${TOOL_OUTCOME_METADATA_PREFIX}saferAlternative`]: JSON.stringify(
            normalizeAction(result.saferAlternative),
          ),
        }
      : {}),
  };
}

export function buildBehavioralOutcomeExperienceRecord(
  input: BehavioralOutcomeExperienceInput & {
    result: BehavioralOutcomeObservationResult;
  },
): ExperienceRecord {
  const result = {
    ...input.result,
    firstAction: normalizeAction(input.result.firstAction),
    saferAlternative: input.result.saferAlternative
      ? normalizeAction(input.result.saferAlternative)
      : undefined,
  };
  const saferAlternativeLabel = result.saferAlternative
    ? ` Safer first action: ${formatBehavioralFirstAction(result.saferAlternative)}.`
    : "";

  return createExperienceRecord({
    id: input.createId(),
    userId: input.scope.userId,
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    agentId: input.scope.agentId,
    sessionId: input.scope.sessionId,
    kind: "tool_outcome",
    traceId: input.traceId,
    trigger: "api",
    modelInfluence: result.modelInfluence,
    summary:
      `Behavioral tool outcome for cue "${result.cue}": first action ${formatBehavioralFirstAction(result.firstAction)} failed with ${result.failureClass}.` +
      saferAlternativeLabel,
    outcome: result.outcome ?? "failure",
    policyApplied: [],
    metadata: buildBehavioralOutcomeMetadata(result),
    metrics: {
      accepted: 0,
      rejected: 1,
    },
    linkedEvidenceIds: input.linkedEvidenceIds ?? [],
    createdAt: input.createdAt,
  });
}

export function isToolOutcomeExperience(
  experience: ExperienceRecord,
): boolean {
  return experience.kind === "tool_outcome";
}

function parseStoredAction(
  value: NonNullable<ExperienceRecord["metadata"]>[string] | undefined,
): BehavioralFirstAction | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const kind = parsed.kind;
    const name = parsed.name;
    const args = parsed.args;
    const raw = parsed.raw;
    if (
      (kind !== "command" && kind !== "tool_call" && kind !== "warning") ||
      typeof name !== "string" || name.trim().length === 0 ||
      (args !== undefined &&
        (!Array.isArray(args) || args.some((item) => typeof item !== "string"))) ||
      (raw !== undefined && typeof raw !== "string")
    ) {
      return undefined;
    }

    return {
      kind,
      name,
      ...(Array.isArray(args) && args.length > 0 ? { args: [...args] } : {}),
      ...(typeof raw === "string" && raw.length > 0 ? { raw } : {}),
    };
  } catch {
    return undefined;
  }
}

export function parseToolOutcomeMetadata(
  experience: ExperienceRecord,
): ParsedToolOutcomeMetadata | null {
  if (!isToolOutcomeExperience(experience)) {
    return null;
  }
  const metadata = experience.metadata;
  if (
    metadata?.[`${TOOL_OUTCOME_METADATA_PREFIX}schema`] !==
      TOOL_OUTCOME_METADATA_SCHEMA ||
    metadata[`${TOOL_OUTCOME_METADATA_PREFIX}version`] !==
      TOOL_OUTCOME_METADATA_VERSION
  ) {
    return null;
  }
  const cue = metadata[`${TOOL_OUTCOME_METADATA_PREFIX}cue`];
  const failureClass = metadata[`${TOOL_OUTCOME_METADATA_PREFIX}failureClass`];
  const firstAction = parseStoredAction(
    metadata[`${TOOL_OUTCOME_METADATA_PREFIX}firstAction`],
  );
  if (
    typeof cue !== "string" || cue.trim().length === 0 ||
    typeof failureClass !== "string" || failureClass.trim().length === 0 ||
    !firstAction
  ) {
    return null;
  }
  const retrievalProfile = metadata[`${TOOL_OUTCOME_METADATA_PREFIX}retrievalProfile`];
  const parsedRetrievalProfile =
    retrievalProfile === "coding_agent" || retrievalProfile === "general_chat"
      ? retrievalProfile
      : undefined;

  return {
    cue,
    failureClass,
    firstAction,
    retrievalProfile: parsedRetrievalProfile,
    saferAlternative: parseStoredAction(
      metadata[`${TOOL_OUTCOME_METADATA_PREFIX}saferAlternative`],
    ),
  };
}

export function attachCompiledGuidance(
  proposal: LearningProposal,
  compiledGuidance: CompiledGuidance,
): LearningProposal {
  return ({
    ...proposal,
    compiledGuidance,
  } as LearningProposalWithCompiledGuidance) as LearningProposal;
}

export function readCompiledGuidance(
  proposal: LearningProposal,
): CompiledGuidance | undefined {
  return (proposal as LearningProposalWithCompiledGuidance).compiledGuidance;
}
