import type {
  FeedbackKind,
  FeedbackMemory,
  MemoryAttributeValue,
} from "../domain/records";
import { normalizeFeedbackAppliesTo } from "../domain/records";
import type {
  LanguageBehavioralRuleAnalysis,
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import { createLanguageService } from "../language";

export type BehavioralPolicyActionKind = "command" | "tool_call" | "warning";
export type BehavioralKind =
  | "preference"
  | "avoidance"
  | "guarded_policy"
  | "format_contract"
  | "first_action"
  | "syntax_constraint"
  | "transformation_rule"
  | "exemplar_fact";
export type BehavioralTransferMode = "example_only" | "pattern_bounded" | "general";
export type BehavioralEnactmentSurface = "text_response" | "host_action";

export interface BehavioralPolicyAction {
  args?: string[];
  kind: BehavioralPolicyActionKind;
  name: string;
  raw?: string;
}

export interface BehavioralPolicyFragments {
  prefixes?: string[];
  required?: string[];
  suffixes?: string[];
}

export interface BehavioralPolicyReplacement {
  from: string;
  to: string;
}

export interface BehavioralPolicyGuard {
  allowedStates?: string[];
  check: string;
  fallbackInstruction?: string;
  subject?: string;
}

export interface BehavioralPolicyFallbackBehavior {
  backupMention?: string;
  preferredAlternatives?: string[];
  replacementTarget?: string;
  warningMessage: string;
}

export interface BehavioralPolicyGuardedBehavior {
  allowedWhen?: string[];
  fallbackBehavior: BehavioralPolicyFallbackBehavior;
  precondition: string;
  subject?: string;
}

export interface BehavioralPolicyUrlTemplate {
  example: string;
  host: string;
  pathPlacement: "path_after_host";
  scheme: "http" | "https";
}

export interface BehavioralPolicyPathTemplate {
  anchor: string;
  example: string;
  variableSegment: "filename";
}

export interface BehavioralPolicyRecurrenceBaseCase {
  index: number;
  value: number;
}

export interface BehavioralPolicyComputedRecurrenceRule {
  expression: string;
  kind: "recurrence";
  sequenceName: string;
  baseCases?: BehavioralPolicyRecurrenceBaseCase[];
}

export interface BehavioralPolicyComputedBinaryOperatorRule {
  expression: string;
  kind: "binary_operator";
  leftVariable: string;
  operatorSymbol: string;
  rightVariable: string;
}

export type BehavioralPolicyComputedResponseRule =
  | BehavioralPolicyComputedBinaryOperatorRule
  | BehavioralPolicyComputedRecurrenceRule;

export interface TextResponseRewriteOutputSlotOperation {
  computedResponseRule?: BehavioralPolicyComputedResponseRule;
  exactFragments?: BehavioralPolicyFragments;
  kind: "rewrite_output_slot";
  pathTemplate?: BehavioralPolicyPathTemplate;
  preferredAlternatives?: string[];
  preferredFragments?: string[];
  replacementPairs?: BehavioralPolicyReplacement[];
  urlTemplate?: BehavioralPolicyUrlTemplate;
}

export interface TextResponseRequireWarningOperation {
  backupMention?: string;
  kind: "require_warning";
  pathTemplate?: BehavioralPolicyPathTemplate;
  preferredAlternatives?: string[];
  replacementTarget?: string;
  urlTemplate?: BehavioralPolicyUrlTemplate;
  warningMessage: string;
}

export interface TextResponseBlockSurfaceOperation {
  fallbackAnswer?: string;
  forbiddenFragments: string[];
  kind: "block_surface";
  replacementPairs?: BehavioralPolicyReplacement[];
}

export interface TextResponseRequirePreconditionCheckOperation {
  allowedWhen?: string[];
  fallbackBehavior: BehavioralPolicyFallbackBehavior;
  kind: "require_precondition_check";
  precondition: string;
  subject?: string;
}

export type TextResponseEnactmentOperation =
  | TextResponseBlockSurfaceOperation
  | TextResponseRequirePreconditionCheckOperation
  | TextResponseRequireWarningOperation
  | TextResponseRewriteOutputSlotOperation;

export interface TextResponseEnactmentPlan {
  bulletOnly?: boolean;
  brevityOnly?: boolean;
  concise: boolean;
  operations: TextResponseEnactmentOperation[];
}

export interface BehavioralPolicyApplicability {
  actionSummaryContains?: string[];
  appliesTo?: string;
  argumentOrder?: string[];
  backupMention?: string;
  canonicalFirstAction?: BehavioralPolicyAction;
  computedResponseRule?: BehavioralPolicyComputedResponseRule;
  exactFragments?: BehavioralPolicyFragments;
  fallbackInstruction?: string;
  forbiddenFragments?: string[];
  guard?: BehavioralPolicyGuard;
  guardedBehavior?: BehavioralPolicyGuardedBehavior;
  preferredAlternatives?: string[];
  preferredFragments?: string[];
  pathTemplate?: BehavioralPolicyPathTemplate;
  queryContains?: string[];
  replacementPairs?: BehavioralPolicyReplacement[];
  textResponsePlan?: TextResponseEnactmentPlan;
  urlTemplate?: BehavioralPolicyUrlTemplate;
}

export interface BehavioralPolicy {
  behavioralKind: BehavioralKind;
  enactmentSurface: BehavioralEnactmentSurface;
  applicability: BehavioralPolicyApplicability;
  transferMode: BehavioralTransferMode;
}

export interface BehavioralPolicySelection {
  feedback: FeedbackMemory;
  matchedQueryTokens: string[];
  policy: BehavioralPolicy;
  score: number;
}

function hasStructuredTextResponseSteering(policy: BehavioralPolicy): boolean {
  if (policy.enactmentSurface !== "text_response") {
    return false;
  }

  return Boolean(
    policy.applicability.textResponsePlan ||
      policy.applicability.computedResponseRule ||
      policy.applicability.urlTemplate ||
      policy.applicability.pathTemplate ||
      policy.applicability.guard ||
      policy.applicability.guardedBehavior ||
      (policy.applicability.replacementPairs?.length ?? 0) > 0 ||
      (policy.applicability.forbiddenFragments?.length ?? 0) > 0 ||
      (policy.applicability.preferredAlternatives?.length ?? 0) > 0 ||
      (policy.applicability.preferredFragments?.length ?? 0) > 0 ||
      (policy.applicability.exactFragments?.prefixes?.length ?? 0) > 0 ||
      (policy.applicability.exactFragments?.required?.length ?? 0) > 0 ||
      (policy.applicability.exactFragments?.suffixes?.length ?? 0) > 0,
  );
}

function hasStructuredHostActionSteering(policy: BehavioralPolicy): boolean {
  if (policy.enactmentSurface !== "host_action") {
    return false;
  }

  return Boolean(
    policy.applicability.canonicalFirstAction ||
      (policy.applicability.argumentOrder?.length ?? 0) > 0,
  );
}

export interface BehavioralPolicySelectionInput {
  appliesTo: string;
  feedback?: readonly FeedbackMemory[];
  query?: string;
  surface: BehavioralEnactmentSurface;
  transientFeedback?: readonly FeedbackMemory[];
}

export interface DeriveRuleBehavioralPolicyInput {
  appliesTo?: string;
  exemplarCount?: number;
  kind: Exclude<FeedbackKind, "validated_pattern">;
  language?: LanguageService;
  languageContext?: ResolvedLanguageContext | string;
  rule: string;
}

const BEHAVIORAL_POLICY_ATTRIBUTE_KEY = "goodmemory.behavioral_policy";
const BEHAVIORAL_POLICY_STEERING_ONLY_ATTRIBUTE_KEY =
  "goodmemory.behavioral_policy.steering_only";
const BEHAVIORAL_POLICY_VERSION_ATTRIBUTE_KEY = "goodmemory.behavioral_policy.version";
const BEHAVIORAL_POLICY_VERSION = 2;
const DEFAULT_LANGUAGE = createLanguageService();
const URL_PROTOCOL_REWRITE = {
  from: "http://",
  to: "https://",
} as const;
const URL_TEMPLATE_PAGE_TOKEN = "<page>";
const FILE_EXTENSION_RE = /\.[A-Za-z0-9]{2,8}/u;
const BEHAVIORAL_KIND_RANK: Record<BehavioralKind, number> = {
  first_action: 8,
  syntax_constraint: 7,
  guarded_policy: 6,
  format_contract: 5,
  avoidance: 4,
  preference: 3,
  transformation_rule: 2,
  exemplar_fact: 1,
};
const TRANSFER_MODE_RANK: Record<BehavioralTransferMode, number> = {
  example_only: 3,
  pattern_bounded: 2,
  general: 1,
};

function normalizeText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function analyzeBehavioralText(
  value: string | undefined,
): LanguageBehavioralRuleAnalysis | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const context = DEFAULT_LANGUAGE.resolveFromText({ text: value });
  return DEFAULT_LANGUAGE.analyzeBehavioralRule(value, context);
}

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function normalizeAction(
  action: BehavioralPolicyAction,
): BehavioralPolicyAction {
  return {
    ...action,
    args: action.args && action.args.length > 0 ? [...action.args] : undefined,
    raw: action.raw?.trim() || undefined,
  };
}

function parseActionTokens(value: string): string[] {
  return [...value.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/gu)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((token) => token.length > 0);
}

export function splitTopLevelCallArguments(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      current += char;
      if (char === quote && value[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === "," && depth === 0) {
      const normalized = current.trim();
      if (normalized.length > 0) {
        args.push(normalized);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const normalized = current.trim();
  if (normalized.length > 0) {
    args.push(normalized);
  }

  return args;
}

function actionFromRawFirstLine(raw: string): BehavioralPolicyAction | undefined {
  const firstLine =
    raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? raw.trim();
  if (!firstLine) {
    return undefined;
  }

  const toolCallMatch = firstLine.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/u);
  if (toolCallMatch) {
    const [, name, argBody] = toolCallMatch;
    return {
      args: splitTopLevelCallArguments(argBody),
      kind: "tool_call",
      name,
      raw: firstLine,
    };
  }

  const tokens = parseActionTokens(firstLine);
  if (tokens.length === 0) {
    return undefined;
  }

  return {
    args: tokens.slice(1),
    kind: "command",
    name: tokens[0],
    raw: firstLine,
  };
}

function normalizeStructuredActionCandidate(value: string): string | undefined {
  const normalized = value.trim().replace(/[.。]$/u, "");
  if (!normalized) {
    return undefined;
  }

  const action = actionFromRawFirstLine(normalized);
  if (!action) {
    return undefined;
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*\(.*\)$/u.test(normalized)) {
    return normalized;
  }

  const tokens = parseActionTokens(normalized);
  const command = tokens[0];
  if (!command || /^(?:a|an|i|it|that|the|this|we|you)$/iu.test(command)) {
    return undefined;
  }

  const hasCommandSurface =
    /[|/@_ΩΨ]/u.test(normalized) ||
    /(?:^|\s)--?[A-Za-z0-9][A-Za-z0-9-]*/u.test(normalized) ||
    /^[A-Za-z0-9_@]+-[A-Za-z0-9_@-]+$/u.test(command) ||
    /^[^\sA-Za-z0-9]/u.test(command);

  return hasCommandSurface ? normalized : undefined;
}

function recoverNaturalLanguageStructuredAction(answer: string): string | undefined {
  const firstLine =
    answer
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? answer.trim();
  if (!firstLine) {
    return undefined;
  }

  const backtickMatch = firstLine.match(/`([^`]+)`/u);
  const backtickCandidate = backtickMatch?.[1]
    ? normalizeStructuredActionCandidate(backtickMatch[1])
    : undefined;
  if (backtickCandidate) {
    return backtickCandidate;
  }

  const prefaceMatch = firstLine.match(
    /^(?:i\s+(?:would\s+)?(?:run|use|enter|submit|write|type)|(?:you\s+)?(?:would\s+)?use|command|enter|run|submit|type|use|write)\s*[:：]\s*(.+)$/iu,
  );
  if (!prefaceMatch?.[1]) {
    return undefined;
  }

  return normalizeStructuredActionCandidate(prefaceMatch[1]);
}

function resolveComparableActionArgs(
  action: BehavioralPolicyAction,
): string[] | undefined {
  const normalized = normalizeAction(action);
  if (normalized.args && normalized.args.length > 0) {
    return normalized.args;
  }

  if (
    normalized.kind === "warning" ||
    !normalized.raw ||
    normalized.raw.trim().length === 0
  ) {
    return undefined;
  }

  const tokens = parseActionTokens(normalized.raw);
  return tokens.length > 1 ? tokens.slice(1) : undefined;
}

function orderedArgsIncluded(
  currentArgs: readonly string[],
  canonicalArgs: readonly string[],
): boolean {
  if (canonicalArgs.length === 0) {
    return true;
  }

  let currentIndex = 0;
  for (const canonicalArg of canonicalArgs) {
    let matched = false;

    while (currentIndex < currentArgs.length) {
      if (currentArgs[currentIndex] === canonicalArg) {
        matched = true;
        currentIndex += 1;
        break;
      }
      currentIndex += 1;
    }

    if (!matched) {
      return false;
    }
  }

  return true;
}

export function serializeBehavioralPolicyAction(
  action: BehavioralPolicyAction,
): string {
  const normalized = normalizeAction(action);
  return JSON.stringify({
    ...(normalized.args ? { args: normalized.args } : {}),
    kind: normalized.kind,
    name: normalized.name,
    ...(normalized.raw ? { raw: normalized.raw } : {}),
  });
}

export function behavioralPolicyActionsEqual(
  left: BehavioralPolicyAction | undefined,
  right: BehavioralPolicyAction | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return serializeBehavioralPolicyAction(left) === serializeBehavioralPolicyAction(right);
}

export function behavioralPolicyActionSatisfiesCanonical(
  current: BehavioralPolicyAction | undefined,
  canonical: BehavioralPolicyAction | undefined,
): boolean {
  if (!current || !canonical) {
    return current === canonical;
  }

  if (current.kind !== canonical.kind || current.name.trim() !== canonical.name.trim()) {
    return false;
  }

  if (canonical.kind === "warning") {
    return behavioralPolicyActionsEqual(current, canonical);
  }

  const canonicalArgs = resolveComparableActionArgs(canonical);
  if (!canonicalArgs || canonicalArgs.length === 0) {
    return true;
  }

  const currentArgs = resolveComparableActionArgs(current);
  if (!currentArgs || currentArgs.length === 0) {
    return false;
  }

  return orderedArgsIncluded(currentArgs, canonicalArgs);
}

function parseBehavioralPolicyAction(value: unknown): BehavioralPolicyAction | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    (value.kind !== "command" &&
      value.kind !== "tool_call" &&
      value.kind !== "warning") ||
    typeof value.name !== "string"
  ) {
    return undefined;
  }

  const args = Array.isArray(value.args) &&
      value.args.every((item) => typeof item === "string")
    ? [...value.args]
    : undefined;

  return {
    ...(args ? { args } : {}),
    kind: value.kind,
    name: value.name,
    ...(typeof value.raw === "string" ? { raw: value.raw } : {}),
  };
}

function parseBehavioralPolicyFragments(
  value: unknown,
): BehavioralPolicyFragments | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const prefixes = parseStringArray(value.prefixes);
  const required = parseStringArray(value.required);
  const suffixes = parseStringArray(value.suffixes);
  if (!prefixes && !required && !suffixes) {
    return undefined;
  }

  return {
    ...(prefixes ? { prefixes } : {}),
    ...(required ? { required } : {}),
    ...(suffixes ? { suffixes } : {}),
  };
}

function parseBehavioralPolicyReplacement(
  value: unknown,
): BehavioralPolicyReplacement | undefined {
  if (!isRecord(value) || typeof value.from !== "string" || typeof value.to !== "string") {
    return undefined;
  }

  const from = value.from.trim();
  const to = value.to.trim();
  if (from.length === 0 || to.length === 0) {
    return undefined;
  }

  return { from, to };
}

function parseBehavioralPolicyGuard(
  value: unknown,
): BehavioralPolicyGuard | undefined {
  if (!isRecord(value) || typeof value.check !== "string") {
    return undefined;
  }

  const check = value.check.trim();
  if (check.length === 0) {
    return undefined;
  }

  const allowedStates = parseStringArray(value.allowedStates);
  const fallbackInstruction =
    typeof value.fallbackInstruction === "string" && value.fallbackInstruction.trim().length > 0
      ? value.fallbackInstruction.trim()
      : undefined;
  const subject =
    typeof value.subject === "string" && value.subject.trim().length > 0
      ? value.subject.trim()
      : undefined;

  return {
    ...(allowedStates ? { allowedStates } : {}),
    check,
    ...(fallbackInstruction ? { fallbackInstruction } : {}),
    ...(subject ? { subject } : {}),
  };
}

function parseBehavioralPolicyFallbackBehavior(
  value: unknown,
): BehavioralPolicyFallbackBehavior | undefined {
  if (!isRecord(value) || typeof value.warningMessage !== "string") {
    return undefined;
  }

  const warningMessage = value.warningMessage.trim();
  if (warningMessage.length === 0) {
    return undefined;
  }

  const preferredAlternatives = parseStringArray(value.preferredAlternatives);
  const replacementTarget =
    typeof value.replacementTarget === "string" && value.replacementTarget.trim().length > 0
      ? value.replacementTarget.trim()
      : undefined;
  const backupMention =
    typeof value.backupMention === "string" && value.backupMention.trim().length > 0
      ? value.backupMention.trim()
      : undefined;

  return {
    ...(backupMention ? { backupMention } : {}),
    ...(preferredAlternatives ? { preferredAlternatives } : {}),
    ...(replacementTarget ? { replacementTarget } : {}),
    warningMessage,
  };
}

function parseBehavioralPolicyGuardedBehavior(
  value: unknown,
): BehavioralPolicyGuardedBehavior | undefined {
  if (!isRecord(value) || typeof value.precondition !== "string") {
    return undefined;
  }

  const precondition = value.precondition.trim();
  const fallbackBehavior = parseBehavioralPolicyFallbackBehavior(
    value.fallbackBehavior,
  );
  if (precondition.length === 0 || !fallbackBehavior) {
    return undefined;
  }

  const allowedWhen = parseStringArray(value.allowedWhen);
  const subject =
    typeof value.subject === "string" && value.subject.trim().length > 0
      ? value.subject.trim()
      : undefined;

  return {
    ...(allowedWhen ? { allowedWhen } : {}),
    fallbackBehavior,
    precondition,
    ...(subject ? { subject } : {}),
  };
}

function parseBehavioralPolicyUrlTemplate(
  value: unknown,
): BehavioralPolicyUrlTemplate | undefined {
  if (
    !isRecord(value) ||
    typeof value.example !== "string" ||
    typeof value.host !== "string" ||
    value.pathPlacement !== "path_after_host" ||
    (value.scheme !== "http" && value.scheme !== "https")
  ) {
    return undefined;
  }

  const example = value.example.trim();
  const host = value.host.trim();
  if (example.length === 0 || host.length === 0) {
    return undefined;
  }

  return {
    example,
    host,
    pathPlacement: "path_after_host",
    scheme: value.scheme,
  };
}

function parseBehavioralPolicyPathTemplate(
  value: unknown,
): BehavioralPolicyPathTemplate | undefined {
  if (
    !isRecord(value) ||
    typeof value.anchor !== "string" ||
    typeof value.example !== "string" ||
    value.variableSegment !== "filename"
  ) {
    return undefined;
  }

  const anchor = value.anchor.trim();
  const example = value.example.trim();
  if (anchor.length === 0 || example.length === 0) {
    return undefined;
  }

  return {
    anchor,
    example,
    variableSegment: "filename",
  };
}

function parseBehavioralPolicyComputedResponseRule(
  value: unknown,
): BehavioralPolicyComputedResponseRule | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }

  if (value.kind === "recurrence") {
    if (
      typeof value.sequenceName !== "string" ||
      typeof value.expression !== "string"
    ) {
      return undefined;
    }

    const sequenceName = value.sequenceName.trim();
    const expression = value.expression.trim();
    const baseCases = Array.isArray(value.baseCases)
      ? value.baseCases
          .map((entry) => {
            if (
              !isRecord(entry) ||
              typeof entry.index !== "number" ||
              typeof entry.value !== "number" ||
              !Number.isInteger(entry.index) ||
              !Number.isFinite(entry.value)
            ) {
              return undefined;
            }

            return {
              index: entry.index,
              value: entry.value,
            } satisfies BehavioralPolicyRecurrenceBaseCase;
          })
          .filter(
            (entry): entry is BehavioralPolicyRecurrenceBaseCase => Boolean(entry),
          )
      : undefined;

    if (sequenceName.length === 0 || expression.length === 0) {
      return undefined;
    }

    return {
      ...(baseCases && baseCases.length > 0 ? { baseCases } : {}),
      expression,
      kind: "recurrence",
      sequenceName,
    };
  }

  if (value.kind === "binary_operator") {
    if (
      typeof value.expression !== "string" ||
      typeof value.leftVariable !== "string" ||
      typeof value.operatorSymbol !== "string" ||
      typeof value.rightVariable !== "string"
    ) {
      return undefined;
    }

    const expression = value.expression.trim();
    const leftVariable = value.leftVariable.trim();
    const operatorSymbol = value.operatorSymbol.trim();
    const rightVariable = value.rightVariable.trim();
    if (
      expression.length === 0 ||
      leftVariable.length === 0 ||
      operatorSymbol.length === 0 ||
      rightVariable.length === 0
    ) {
      return undefined;
    }

    return {
      expression,
      kind: "binary_operator",
      leftVariable,
      operatorSymbol,
      rightVariable,
    };
  }

  return undefined;
}

function parseTextResponseRewriteOutputSlotOperation(
  value: unknown,
): TextResponseRewriteOutputSlotOperation | undefined {
  if (!isRecord(value) || value.kind !== "rewrite_output_slot") {
    return undefined;
  }

  const exactFragments = parseBehavioralPolicyFragments(value.exactFragments);
  const pathTemplate = parseBehavioralPolicyPathTemplate(value.pathTemplate);
  const preferredAlternatives = parseStringArray(value.preferredAlternatives);
  const preferredFragments = parseStringArray(value.preferredFragments);
  const replacementPairs =
    Array.isArray(value.replacementPairs)
      ? value.replacementPairs
          .map((entry) => parseBehavioralPolicyReplacement(entry))
          .filter((entry): entry is BehavioralPolicyReplacement => Boolean(entry))
      : undefined;
  const urlTemplate = parseBehavioralPolicyUrlTemplate(value.urlTemplate);
  const computedResponseRule = parseBehavioralPolicyComputedResponseRule(
    value.computedResponseRule,
  );

  if (
    !computedResponseRule &&
    !exactFragments &&
    !pathTemplate &&
    !preferredAlternatives &&
    !preferredFragments &&
    !replacementPairs &&
    !urlTemplate
  ) {
    return undefined;
  }

  return {
    ...(computedResponseRule ? { computedResponseRule } : {}),
    ...(exactFragments ? { exactFragments } : {}),
    kind: "rewrite_output_slot",
    ...(pathTemplate ? { pathTemplate } : {}),
    ...(preferredAlternatives ? { preferredAlternatives } : {}),
    ...(preferredFragments ? { preferredFragments } : {}),
    ...(replacementPairs && replacementPairs.length > 0 ? { replacementPairs } : {}),
    ...(urlTemplate ? { urlTemplate } : {}),
  };
}

function parseTextResponseRequireWarningOperation(
  value: unknown,
): TextResponseRequireWarningOperation | undefined {
  if (!isRecord(value) || value.kind !== "require_warning" || typeof value.warningMessage !== "string") {
    return undefined;
  }

  const warningMessage = value.warningMessage.trim();
  if (warningMessage.length === 0) {
    return undefined;
  }

  const preferredAlternatives = parseStringArray(value.preferredAlternatives);
  const pathTemplate = parseBehavioralPolicyPathTemplate(value.pathTemplate);
  const replacementTarget =
    typeof value.replacementTarget === "string" && value.replacementTarget.trim().length > 0
      ? value.replacementTarget.trim()
      : undefined;
  const urlTemplate = parseBehavioralPolicyUrlTemplate(value.urlTemplate);
  const backupMention =
    typeof value.backupMention === "string" && value.backupMention.trim().length > 0
      ? value.backupMention.trim()
      : undefined;

  return {
    ...(backupMention ? { backupMention } : {}),
    kind: "require_warning",
    ...(pathTemplate ? { pathTemplate } : {}),
    ...(preferredAlternatives ? { preferredAlternatives } : {}),
    ...(replacementTarget ? { replacementTarget } : {}),
    ...(urlTemplate ? { urlTemplate } : {}),
    warningMessage,
  };
}

function parseTextResponseBlockSurfaceOperation(
  value: unknown,
): TextResponseBlockSurfaceOperation | undefined {
  if (!isRecord(value) || value.kind !== "block_surface") {
    return undefined;
  }

  const forbiddenFragments = parseStringArray(value.forbiddenFragments);
  if (!forbiddenFragments) {
    return undefined;
  }
  const replacementPairs =
    Array.isArray(value.replacementPairs)
      ? value.replacementPairs
          .map((entry) => parseBehavioralPolicyReplacement(entry))
          .filter((entry): entry is BehavioralPolicyReplacement => Boolean(entry))
      : undefined;
  const fallbackAnswer =
    typeof value.fallbackAnswer === "string" && value.fallbackAnswer.trim().length > 0
      ? value.fallbackAnswer.trim()
      : undefined;

  return {
    ...(fallbackAnswer ? { fallbackAnswer } : {}),
    forbiddenFragments,
    kind: "block_surface",
    ...(replacementPairs && replacementPairs.length > 0 ? { replacementPairs } : {}),
  };
}

function parseTextResponseRequirePreconditionCheckOperation(
  value: unknown,
): TextResponseRequirePreconditionCheckOperation | undefined {
  if (!isRecord(value) || value.kind !== "require_precondition_check" || typeof value.precondition !== "string") {
    return undefined;
  }

  const precondition = value.precondition.trim();
  const fallbackBehavior = parseBehavioralPolicyFallbackBehavior(
    value.fallbackBehavior,
  );
  if (precondition.length === 0 || !fallbackBehavior) {
    return undefined;
  }
  const allowedWhen = parseStringArray(value.allowedWhen);
  const subject =
    typeof value.subject === "string" && value.subject.trim().length > 0
      ? value.subject.trim()
      : undefined;

  return {
    ...(allowedWhen ? { allowedWhen } : {}),
    fallbackBehavior,
    kind: "require_precondition_check",
    precondition,
    ...(subject ? { subject } : {}),
  };
}

function parseTextResponseEnactmentOperation(
  value: unknown,
): TextResponseEnactmentOperation | undefined {
  return (
    parseTextResponseRewriteOutputSlotOperation(value) ??
    parseTextResponseRequireWarningOperation(value) ??
    parseTextResponseBlockSurfaceOperation(value) ??
    parseTextResponseRequirePreconditionCheckOperation(value)
  );
}

function parseTextResponseEnactmentPlan(
  value: unknown,
): TextResponseEnactmentPlan | undefined {
  if (!isRecord(value) || !Array.isArray(value.operations)) {
    return undefined;
  }

  const operations = value.operations
    .map((entry) => parseTextResponseEnactmentOperation(entry))
    .filter((entry): entry is TextResponseEnactmentOperation => Boolean(entry));
  if (operations.length === 0) {
    return undefined;
  }

  return {
    ...(value.bulletOnly === true ? { bulletOnly: true } : {}),
    ...(value.brevityOnly === true ? { brevityOnly: true } : {}),
    concise: value.concise !== false,
    operations,
  };
}

function parseBehavioralPolicyApplicability(
  value: unknown,
): BehavioralPolicyApplicability | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const actionSummaryContains = parseStringArray(value.actionSummaryContains);
  const queryContains = parseStringArray(value.queryContains);
  const argumentOrder = parseStringArray(value.argumentOrder);
  const exactFragments = parseBehavioralPolicyFragments(value.exactFragments);
  const forbiddenFragments = parseStringArray(value.forbiddenFragments);
  const preferredAlternatives = parseStringArray(value.preferredAlternatives);
  const preferredFragments = parseStringArray(value.preferredFragments);
  const pathTemplate = parseBehavioralPolicyPathTemplate(value.pathTemplate);
  const computedResponseRule = parseBehavioralPolicyComputedResponseRule(
    value.computedResponseRule,
  );
  const replacementPairs =
    Array.isArray(value.replacementPairs)
      ? value.replacementPairs
          .map((entry) => parseBehavioralPolicyReplacement(entry))
          .filter((entry): entry is BehavioralPolicyReplacement => Boolean(entry))
      : undefined;
  const urlTemplate = parseBehavioralPolicyUrlTemplate(value.urlTemplate);
  const guard = parseBehavioralPolicyGuard(value.guard);
  const guardedBehavior =
    parseBehavioralPolicyGuardedBehavior(value.guardedBehavior) ??
    (guard
      ? {
          allowedWhen: guard.allowedStates,
          fallbackBehavior: {
            warningMessage:
              guard.fallbackInstruction ??
              "Warn or defer instead of assuming the precondition already passed.",
          },
          precondition: guard.check,
          ...(guard.subject ? { subject: guard.subject } : {}),
        }
      : undefined);
  const canonicalFirstAction = parseBehavioralPolicyAction(value.canonicalFirstAction);
  const textResponsePlan = parseTextResponseEnactmentPlan(value.textResponsePlan);
  const appliesTo =
    typeof value.appliesTo === "string"
      ? normalizeFeedbackAppliesTo(value.appliesTo)
      : undefined;
  const fallbackInstruction =
    typeof value.fallbackInstruction === "string" && value.fallbackInstruction.trim().length > 0
      ? value.fallbackInstruction.trim()
      : undefined;
  const backupMention =
    typeof value.backupMention === "string" && value.backupMention.trim().length > 0
      ? value.backupMention.trim()
      : undefined;

  return {
    ...(actionSummaryContains ? { actionSummaryContains } : {}),
    ...(appliesTo ? { appliesTo } : {}),
    ...(argumentOrder ? { argumentOrder } : {}),
    ...(backupMention ? { backupMention } : {}),
    ...(canonicalFirstAction ? { canonicalFirstAction } : {}),
    ...(computedResponseRule ? { computedResponseRule } : {}),
    ...(exactFragments ? { exactFragments } : {}),
    ...(fallbackInstruction ? { fallbackInstruction } : {}),
    ...(forbiddenFragments ? { forbiddenFragments } : {}),
    ...(guard ? { guard } : {}),
    ...(guardedBehavior ? { guardedBehavior } : {}),
    ...(preferredAlternatives ? { preferredAlternatives } : {}),
    ...(preferredFragments ? { preferredFragments } : {}),
    ...(pathTemplate ? { pathTemplate } : {}),
    ...(queryContains ? { queryContains } : {}),
    ...(replacementPairs && replacementPairs.length > 0
      ? { replacementPairs }
      : {}),
    ...(textResponsePlan ? { textResponsePlan } : {}),
    ...(urlTemplate ? { urlTemplate } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }

  const normalized = uniqueStrings(value);
  return normalized.length > 0 ? normalized : undefined;
}

export function parseBehavioralPolicy(
  value: unknown,
): BehavioralPolicy | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    value.behavioralKind !== "preference" &&
    value.behavioralKind !== "avoidance" &&
    value.behavioralKind !== "guarded_policy" &&
    value.behavioralKind !== "format_contract" &&
    value.behavioralKind !== "first_action" &&
    value.behavioralKind !== "syntax_constraint" &&
    value.behavioralKind !== "transformation_rule" &&
    value.behavioralKind !== "exemplar_fact"
  ) {
    return undefined;
  }
  if (
    value.transferMode !== "example_only" &&
    value.transferMode !== "pattern_bounded" &&
    value.transferMode !== "general"
  ) {
    return undefined;
  }
  if (
    value.enactmentSurface !== "text_response" &&
    value.enactmentSurface !== "host_action"
  ) {
    return undefined;
  }

  return {
    behavioralKind: value.behavioralKind,
    enactmentSurface: value.enactmentSurface,
    applicability: parseBehavioralPolicyApplicability(value.applicability) ?? {},
    transferMode: value.transferMode,
  };
}

export function serializeBehavioralPolicy(policy: BehavioralPolicy): string {
  return JSON.stringify(policy);
}

function isStructuredSteeringOnlyPolicy(policy: BehavioralPolicy): boolean {
  if (policy.enactmentSurface === "host_action") {
    return false;
  }

  const applicability = policy.applicability;
  return Boolean(
    applicability.argumentOrder ||
      applicability.canonicalFirstAction ||
      applicability.exactFragments ||
      applicability.fallbackInstruction ||
      (applicability.forbiddenFragments &&
        applicability.forbiddenFragments.length > 0) ||
      applicability.guard ||
      applicability.guardedBehavior ||
      applicability.pathTemplate ||
      (applicability.preferredAlternatives &&
        applicability.preferredAlternatives.length > 0) ||
      (applicability.replacementPairs &&
        applicability.replacementPairs.length > 0) ||
      applicability.textResponsePlan ||
      applicability.urlTemplate,
  );
}

export function attachBehavioralPolicyAttributes(
  attributes: Record<string, MemoryAttributeValue> | undefined,
  policy: BehavioralPolicy,
): Record<string, MemoryAttributeValue> {
  return {
    ...(attributes ?? {}),
    [BEHAVIORAL_POLICY_ATTRIBUTE_KEY]: serializeBehavioralPolicy(policy),
    ...(isStructuredSteeringOnlyPolicy(policy)
      ? { [BEHAVIORAL_POLICY_STEERING_ONLY_ATTRIBUTE_KEY]: true }
      : {}),
    [BEHAVIORAL_POLICY_VERSION_ATTRIBUTE_KEY]: BEHAVIORAL_POLICY_VERSION,
  };
}

export function readBehavioralPolicyFromAttributes(
  attributes: Record<string, MemoryAttributeValue> | undefined,
): BehavioralPolicy | undefined {
  const raw = attributes?.[BEHAVIORAL_POLICY_ATTRIBUTE_KEY];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }

  try {
    return parseBehavioralPolicy(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function readBehavioralPolicyFromFeedbackMemory(
  feedback: Pick<FeedbackMemory, "attributes">,
): BehavioralPolicy | undefined {
  return readBehavioralPolicyFromAttributes(feedback.attributes);
}

export function isSteeringOnlyBehavioralPolicy(
  feedback: Pick<FeedbackMemory, "attributes">,
): boolean {
  return feedback.attributes?.[BEHAVIORAL_POLICY_STEERING_ONLY_ATTRIBUTE_KEY] === true;
}

function transferModeForRule(input: {
  exemplarCount?: number;
  hasGeneralRuleMarker: boolean;
}): BehavioralTransferMode {
  if (input.exemplarCount !== undefined && input.exemplarCount <= 1 && !input.hasGeneralRuleMarker) {
    return "example_only";
  }
  if (input.hasGeneralRuleMarker) {
    return "general";
  }
  return (input.exemplarCount ?? 0) >= 2 ? "pattern_bounded" : "example_only";
}

function buildFiletypeReplacementApplicability(
  analysis: NonNullable<LanguageBehavioralRuleAnalysis["filetypeReplacement"]>,
): Pick<
  BehavioralPolicyApplicability,
  "forbiddenFragments" | "preferredFragments" | "replacementPairs"
> | null {
  const { forbidden, preferred } = analysis;
  const forbiddenExtension = forbidden.match(FILE_EXTENSION_RE)?.[0];
  const preferredExtension = preferred.match(FILE_EXTENSION_RE)?.[0];
  const replacementPairs: BehavioralPolicyReplacement[] = [];
  if (!forbidden.startsWith(".") || preferred.startsWith(".")) {
    replacementPairs.push({
      from: forbidden,
      to: preferred,
    });
  }
  if (forbiddenExtension && preferredExtension) {
    replacementPairs.push({
      from: forbiddenExtension,
      to: preferredExtension,
    });
  }

  return {
    forbiddenFragments: uniqueStrings([forbidden, forbiddenExtension]),
    preferredFragments: uniqueStrings([preferred, preferredExtension]),
    replacementPairs: uniqueReplacementPairs(replacementPairs),
  };
}

function buildDistrustRoutingApplicability(
  analysis: NonNullable<LanguageBehavioralRuleAnalysis["distrustRouting"]>,
): Pick<
  BehavioralPolicyApplicability,
  "fallbackInstruction" | "forbiddenFragments" | "preferredAlternatives" | "queryContains"
> | null {
  const distrustedTarget = analysis.target;
  const preferredAlternative = analysis.preferredAlternative;
  const warningTarget = preferredAlternative ?? "a specialist path";

  return {
    fallbackInstruction:
      `Warn and route to ${warningTarget} instead of using the distrusted default path.`,
    forbiddenFragments: [distrustedTarget],
    ...(preferredAlternative ? { preferredAlternatives: [preferredAlternative] } : {}),
    queryContains: [distrustedTarget],
  };
}

function buildBehavioralGuard(
  analysis: NonNullable<LanguageBehavioralRuleAnalysis["guard"]>,
): BehavioralPolicyGuard {
  const { allowedStates, check, subject } = analysis;
  return {
    ...(allowedStates.length > 0 ? { allowedStates } : {}),
    check,
    fallbackInstruction:
      `Check ${check} first${allowedStates.length > 0 ? ` and only proceed when ${allowedStates.join(" or ")}` : ""}; otherwise warn or defer instead of assuming it already passed.`,
    ...(subject ? { subject } : {}),
  };
}

function buildProtocolRewriteApplicability(
  analysis: NonNullable<LanguageBehavioralRuleAnalysis["protocolRewrite"]>,
): Pick<
  BehavioralPolicyApplicability,
  | "fallbackInstruction"
  | "forbiddenFragments"
  | "preferredFragments"
  | "queryContains"
  | "replacementPairs"
  | "urlTemplate"
> | null {
  let preferredFragments: string[] | undefined;
  let urlTemplate: BehavioralPolicyUrlTemplate | undefined;
  if (analysis.template) {
    const example = analysis.template;
    const parsed = new URL(example.replace(URL_TEMPLATE_PAGE_TOKEN, "page"));
    preferredFragments = [`${parsed.protocol}//${parsed.host}/`];
    urlTemplate = {
      example,
      host: parsed.host,
      pathPlacement: "path_after_host",
      scheme: parsed.protocol === "https:" ? "https" : "http",
    };
  }

  return {
    fallbackInstruction:
      "If the current probe explicitly requests http, warn first and then offer the https URL instead of silently substituting protocols.",
    forbiddenFragments: [URL_PROTOCOL_REWRITE.from],
    ...(preferredFragments ? { preferredFragments } : {}),
    queryContains: ["url"],
    replacementPairs: [URL_PROTOCOL_REWRITE],
    ...(urlTemplate ? { urlTemplate } : {}),
  };
}

function buildDirectoryRestrictionApplicability(
  analysis: NonNullable<LanguageBehavioralRuleAnalysis["directoryRestriction"]>,
): Pick<
  BehavioralPolicyApplicability,
  "fallbackInstruction" | "forbiddenFragments" | "pathTemplate" | "preferredFragments"
> | null {
  const { forbiddenRoot, safeTemplate } = analysis;
  let preferredFragments: string[] | undefined;
  let pathTemplate: BehavioralPolicyPathTemplate | undefined;
  if (safeTemplate) {
    const example = safeTemplate;
    const anchor = example.replace(/<file>$/u, "");
    preferredFragments = [anchor];
    pathTemplate = {
      anchor,
      example,
      variableSegment: "filename",
    };
  }

  if (!forbiddenRoot && !pathTemplate && !analysis.userHomeRequired) {
    return null;
  }

  return {
    fallbackInstruction:
      "Refuse the unsafe path and redirect to a safe user-writable home-directory path instead.",
    ...(forbiddenRoot ? { forbiddenFragments: [forbiddenRoot] } : {}),
    ...(preferredFragments
      ? { preferredFragments }
      : analysis.userHomeRequired
        ? { preferredFragments: ["/home/"] }
        : {}),
    ...(pathTemplate ? { pathTemplate } : {}),
  };
}

function buildPreferredReplacementTarget(
  preferredAlternatives: readonly string[] | undefined,
): string | undefined {
  return preferredAlternatives?.[0];
}

function buildFallbackBehavior(input: {
  backupMention?: string;
  fallbackInstruction?: string;
  preferredAlternatives?: readonly string[];
  replacementTarget?: string;
}): BehavioralPolicyFallbackBehavior | undefined {
  const warningMessage =
    input.fallbackInstruction ??
    (input.preferredAlternatives && input.preferredAlternatives.length > 0
      ? `Warn first and redirect to ${input.preferredAlternatives.join(" or ")} instead of proceeding directly.`
      : undefined);
  if (!warningMessage) {
    return undefined;
  }

  return {
    ...(input.backupMention ? { backupMention: input.backupMention } : {}),
    ...(input.preferredAlternatives && input.preferredAlternatives.length > 0
      ? { preferredAlternatives: [...input.preferredAlternatives] }
      : {}),
    ...(input.replacementTarget ? { replacementTarget: input.replacementTarget } : {}),
    warningMessage,
  };
}

function createTextResponseEnactmentPlan(input: {
  behavioralKind: BehavioralKind;
  applicability: BehavioralPolicyApplicability;
}): TextResponseEnactmentPlan | undefined {
  const operations: TextResponseEnactmentOperation[] = [];
  const rewriteOperation: TextResponseRewriteOutputSlotOperation = {
    ...(input.applicability.computedResponseRule
      ? { computedResponseRule: input.applicability.computedResponseRule }
      : {}),
    kind: "rewrite_output_slot",
    ...(input.applicability.exactFragments
      ? { exactFragments: input.applicability.exactFragments }
      : {}),
    ...(input.applicability.pathTemplate
      ? { pathTemplate: input.applicability.pathTemplate }
      : {}),
    ...(input.applicability.preferredAlternatives &&
    input.applicability.preferredAlternatives.length > 0
      ? { preferredAlternatives: input.applicability.preferredAlternatives }
      : {}),
    ...(input.applicability.preferredFragments &&
    input.applicability.preferredFragments.length > 0
      ? { preferredFragments: input.applicability.preferredFragments }
      : {}),
    ...(input.applicability.replacementPairs &&
    input.applicability.replacementPairs.length > 0
      ? { replacementPairs: input.applicability.replacementPairs }
      : {}),
    ...(input.applicability.urlTemplate
      ? { urlTemplate: input.applicability.urlTemplate }
      : {}),
  };
  if (
    rewriteOperation.computedResponseRule ||
    rewriteOperation.exactFragments ||
    rewriteOperation.pathTemplate ||
    rewriteOperation.preferredAlternatives ||
    rewriteOperation.preferredFragments ||
    rewriteOperation.replacementPairs ||
    rewriteOperation.urlTemplate
  ) {
    operations.push(rewriteOperation);
  }

  if (
    input.applicability.forbiddenFragments &&
    input.applicability.forbiddenFragments.length > 0
  ) {
    operations.push({
      forbiddenFragments: [...input.applicability.forbiddenFragments],
      kind: "block_surface",
      ...(input.applicability.replacementPairs &&
      input.applicability.replacementPairs.length > 0
        ? { replacementPairs: input.applicability.replacementPairs }
        : {}),
    });
  }

  if (input.applicability.guardedBehavior) {
    operations.unshift({
      ...(input.applicability.guardedBehavior.allowedWhen
        ? { allowedWhen: input.applicability.guardedBehavior.allowedWhen }
        : {}),
      fallbackBehavior: input.applicability.guardedBehavior.fallbackBehavior,
      kind: "require_precondition_check",
      precondition: input.applicability.guardedBehavior.precondition,
      ...(input.applicability.guardedBehavior.subject
        ? { subject: input.applicability.guardedBehavior.subject }
        : {}),
    });
  } else {
    const fallbackBehavior = buildFallbackBehavior({
      backupMention: input.applicability.backupMention,
      fallbackInstruction: input.applicability.fallbackInstruction,
      preferredAlternatives: input.applicability.preferredAlternatives,
      replacementTarget: buildPreferredReplacementTarget(
        input.applicability.preferredAlternatives,
      ),
    });
    if (
      fallbackBehavior &&
      (input.behavioralKind === "avoidance" ||
        input.behavioralKind === "preference" ||
        input.behavioralKind === "transformation_rule" ||
        (fallbackBehavior.preferredAlternatives &&
          fallbackBehavior.preferredAlternatives.length > 0) ||
        fallbackBehavior.backupMention ||
        fallbackBehavior.replacementTarget)
    ) {
      operations.push({
        ...(fallbackBehavior.backupMention
          ? { backupMention: fallbackBehavior.backupMention }
          : {}),
        kind: "require_warning",
        ...(input.applicability.pathTemplate
          ? { pathTemplate: input.applicability.pathTemplate }
          : {}),
        ...(fallbackBehavior.preferredAlternatives
          ? { preferredAlternatives: fallbackBehavior.preferredAlternatives }
          : {}),
        ...(fallbackBehavior.replacementTarget
          ? { replacementTarget: fallbackBehavior.replacementTarget }
          : {}),
        ...(input.applicability.urlTemplate
          ? { urlTemplate: input.applicability.urlTemplate }
          : {}),
        warningMessage: fallbackBehavior.warningMessage,
      });
    }
  }

  return operations.length > 0
    ? {
        concise: true,
        operations,
      }
    : undefined;
}

function looksLikeFormatRule(
  analysis: LanguageBehavioralRuleAnalysis,
): boolean {
  return analysis.formatRule;
}

function looksLikeNegativeRule(
  analysis: LanguageBehavioralRuleAnalysis,
): boolean {
  return analysis.negativeRule;
}

function looksLikeHostActionRule(
  analysis: LanguageBehavioralRuleAnalysis,
): boolean {
  return analysis.firstActionName !== undefined;
}

function extractHostActionName(
  analysis: LanguageBehavioralRuleAnalysis,
): string | undefined {
  return analysis.firstActionName;
}

function hasGeneralRuleMarker(
  analysis: LanguageBehavioralRuleAnalysis,
): boolean {
  return analysis.generalRule;
}

export function extractComputedResponseRule(
  rule: string,
): BehavioralPolicyComputedResponseRule | undefined {
  const recurrenceMatch = rule.match(
    /\b([A-Z][A-Za-z0-9_]*)\(n\)\s*=\s*([^.\n]+?)(?:\.|\n|$)/u,
  );
  if (recurrenceMatch?.[1] && recurrenceMatch[2]) {
    const sequenceName = recurrenceMatch[1].trim();
    const expression = recurrenceMatch[2].trim();
    const baseCases = [...rule.matchAll(new RegExp(`${escapeRegExpLiteral(sequenceName)}\\((-?\\d+)\\)\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`, "gu"))]
      .map((match) => {
        const index = Number(match[1]);
        const value = Number(match[2]);
        if (!Number.isInteger(index) || !Number.isFinite(value)) {
          return undefined;
        }
        return {
          index,
          value,
        } satisfies BehavioralPolicyRecurrenceBaseCase;
      })
      .filter((entry): entry is BehavioralPolicyRecurrenceBaseCase => Boolean(entry));

    return {
      ...(baseCases.length > 0 ? { baseCases } : {}),
      expression,
      kind: "recurrence",
      sequenceName,
    };
  }

  const binaryMatch = rule.match(
    /\b([a-z])\s*([⊗⊕⊖Ω])\s*([a-z])\s*=\s*([^.\n]+?)(?:\.|\n|$)/u,
  );
  if (binaryMatch?.[1] && binaryMatch[2] && binaryMatch[3] && binaryMatch[4]) {
    return {
      expression: binaryMatch[4].trim(),
      kind: "binary_operator",
      leftVariable: binaryMatch[1].trim(),
      operatorSymbol: binaryMatch[2].trim(),
      rightVariable: binaryMatch[3].trim(),
    };
  }

  return undefined;
}

export function deriveRuleBehavioralPolicy(
  input: DeriveRuleBehavioralPolicyInput,
): BehavioralPolicy {
  const language = input.language ?? DEFAULT_LANGUAGE;
  const languageContext = input.languageContext ?? language.resolveFromText({
    text: input.rule,
  });
  const ruleAnalysis = language.analyzeBehavioralRule(
    input.rule,
    languageContext,
  );
  const generalRule = hasGeneralRuleMarker(ruleAnalysis);
  const transferMode = transferModeForRule({
    exemplarCount: input.exemplarCount,
    hasGeneralRuleMarker: generalRule,
  });
  const queryContains = ruleAnalysis.triggerPhrases;
  const appliesTo = normalizeFeedbackAppliesTo(input.appliesTo);
  const protocolApplicability = ruleAnalysis.protocolRewrite
    ? buildProtocolRewriteApplicability(ruleAnalysis.protocolRewrite)
    : null;
  const directoryApplicability = ruleAnalysis.directoryRestriction
    ? buildDirectoryRestrictionApplicability(ruleAnalysis.directoryRestriction)
    : null;
  const filetypeApplicability = ruleAnalysis.filetypeReplacement
    ? buildFiletypeReplacementApplicability(ruleAnalysis.filetypeReplacement)
    : null;
  const distrustApplicability = ruleAnalysis.distrustRouting
    ? buildDistrustRoutingApplicability(ruleAnalysis.distrustRouting)
    : null;
  const exactCommandAction = ruleAnalysis.exactAction
    ? actionFromRawFirstLine(ruleAnalysis.exactAction)
    : undefined;
  const computedResponseRule = extractComputedResponseRule(input.rule);
  const preferredAlternatives = uniqueStrings([
    ...(ruleAnalysis.preferredAlternatives ?? []),
    ...(distrustApplicability?.preferredAlternatives ?? []),
  ]);
  const guard = ruleAnalysis.guard
    ? buildBehavioralGuard(ruleAnalysis.guard)
    : undefined;
  const mergedQueryContains = uniqueStrings([
    ...(ruleAnalysis.triggerPhrases ?? []),
    ...(guard?.check ? [guard.check] : []),
    ...(guard?.subject ? [guard.subject] : []),
    ...(protocolApplicability?.queryContains ?? []),
    ...(distrustApplicability?.queryContains ?? []),
  ]);
  const backupMention = ruleAnalysis.backupRequested
    ? "Mention a safe backup before proceeding."
    : undefined;
  const forbiddenFragments = uniqueStrings([
    ...(ruleAnalysis.forbiddenFragments ?? []),
    ...(protocolApplicability?.forbiddenFragments ?? []),
    ...(directoryApplicability?.forbiddenFragments ?? []),
    ...(filetypeApplicability?.forbiddenFragments ?? []),
    ...(distrustApplicability?.forbiddenFragments ?? []),
  ]);
  const preferredFragments = uniqueStrings([
    ...(ruleAnalysis.preferredFragments ?? []),
    ...(protocolApplicability?.preferredFragments ?? []),
    ...(directoryApplicability?.preferredFragments ?? []),
    ...(filetypeApplicability?.preferredFragments ?? []),
  ]);
  const pathTemplate = directoryApplicability?.pathTemplate;
  const replacementPairs = uniqueReplacementPairs([
    ...(protocolApplicability?.replacementPairs ?? []),
    ...(filetypeApplicability?.replacementPairs ?? []),
  ]);
  const urlTemplate = protocolApplicability?.urlTemplate;
  const fallbackInstruction =
    guard?.fallbackInstruction ??
    distrustApplicability?.fallbackInstruction ??
    protocolApplicability?.fallbackInstruction ??
    directoryApplicability?.fallbackInstruction ??
    (preferredAlternatives.length > 0 && looksLikeNegativeRule(ruleAnalysis)
      ? `Prefer ${preferredAlternatives.join(" or ")}${
          backupMention ? " and mention a safe backup before proceeding" : ""
        } or warn instead of implying the avoided behavior.`
      : undefined);
  const guardedBehavior = guard
    ? {
        ...(guard.allowedStates ? { allowedWhen: guard.allowedStates } : {}),
        fallbackBehavior: {
          ...(backupMention ? { backupMention } : {}),
          ...(preferredAlternatives.length > 0 ? { preferredAlternatives } : {}),
          ...(preferredAlternatives[0]
            ? { replacementTarget: preferredAlternatives[0] }
            : {}),
          warningMessage:
            guard.fallbackInstruction ??
            "Warn or defer instead of assuming the required precondition already passed.",
        },
        precondition: guard.check,
        ...(guard.subject ? { subject: guard.subject } : {}),
      } satisfies BehavioralPolicyGuardedBehavior
    : undefined;

  if (exactCommandAction || looksLikeHostActionRule(ruleAnalysis)) {
    const actionName = extractHostActionName(ruleAnalysis);
    const argumentOrder = ruleAnalysis.argumentOrder;
    const negative = looksLikeNegativeRule(ruleAnalysis) || input.kind === "dont";
    return {
      behavioralKind: negative ? "first_action" : "syntax_constraint",
      enactmentSurface: "host_action",
      applicability: {
        appliesTo,
        ...(exactCommandAction
          ? {
              canonicalFirstAction: exactCommandAction,
            }
          : actionName
          ? {
              canonicalFirstAction: {
                kind: actionName.includes("_") ? "tool_call" : "command",
                name: actionName,
              },
            }
          : {}),
        ...(argumentOrder ? { argumentOrder } : {}),
        ...(queryContains && !exactCommandAction ? { queryContains } : {}),
      },
      transferMode:
        transferMode === "general" ? "pattern_bounded" : transferMode,
    };
  }

  if (looksLikeFormatRule(ruleAnalysis)) {
    const prefix = ruleAnalysis.formatPrefix;
    const suffix = ruleAnalysis.formatSuffix;
    const required = uniqueStrings([
      ...(ruleAnalysis.requiredFragments ?? []).filter(
        (fragment) => fragment !== suffix,
      ),
      prefix,
      suffix,
    ]);
    return {
      behavioralKind: "format_contract",
      enactmentSurface: "text_response",
      applicability: {
        appliesTo,
        exactFragments: {
          ...(prefix ? { prefixes: [prefix] } : {}),
          ...(required.length > 0 ? { required } : {}),
          ...(suffix ? { suffixes: [suffix] } : {}),
        },
        ...(queryContains ? { queryContains } : {}),
        textResponsePlan: createTextResponseEnactmentPlan({
          behavioralKind: "format_contract",
          applicability: {
            appliesTo,
            exactFragments: {
              ...(prefix ? { prefixes: [prefix] } : {}),
              ...(required.length > 0 ? { required } : {}),
              ...(suffix ? { suffixes: [suffix] } : {}),
            },
            ...(queryContains ? { queryContains } : {}),
          },
        }),
      },
      transferMode,
    };
  }

  if (input.kind === "prefer") {
    const applicability: BehavioralPolicyApplicability = {
      appliesTo,
      ...(backupMention ? { backupMention } : {}),
      ...(fallbackInstruction ? { fallbackInstruction } : {}),
      ...(computedResponseRule ? { computedResponseRule } : {}),
      ...(forbiddenFragments.length > 0 ? { forbiddenFragments } : {}),
      ...(guard ? { guard } : {}),
      ...(guardedBehavior ? { guardedBehavior } : {}),
      ...(preferredAlternatives.length > 0 ? { preferredAlternatives } : {}),
      ...(preferredFragments.length > 0 ? { preferredFragments } : {}),
      ...(pathTemplate ? { pathTemplate } : {}),
      ...(mergedQueryContains.length > 0
        ? { queryContains: mergedQueryContains }
        : {}),
      ...(replacementPairs && replacementPairs.length > 0
        ? { replacementPairs }
        : {}),
      ...(urlTemplate ? { urlTemplate } : {}),
    };
    return {
      behavioralKind: guardedBehavior ? "guarded_policy" : "preference",
      enactmentSurface: "text_response",
      applicability: {
        ...applicability,
        ...(createTextResponseEnactmentPlan({
          behavioralKind: guardedBehavior ? "guarded_policy" : "preference",
          applicability,
        })
          ? {
              textResponsePlan: createTextResponseEnactmentPlan({
                behavioralKind: guardedBehavior ? "guarded_policy" : "preference",
                applicability,
              }),
            }
          : {}),
      },
      transferMode,
    };
  }

  if (input.kind === "dont" || looksLikeNegativeRule(ruleAnalysis)) {
    const applicability: BehavioralPolicyApplicability = {
      appliesTo,
      ...(backupMention ? { backupMention } : {}),
      ...(fallbackInstruction ? { fallbackInstruction } : {}),
      ...(computedResponseRule ? { computedResponseRule } : {}),
      ...(forbiddenFragments.length > 0 ? { forbiddenFragments } : {}),
      ...(guard ? { guard } : {}),
      ...(guardedBehavior ? { guardedBehavior } : {}),
      ...(preferredAlternatives.length > 0 ? { preferredAlternatives } : {}),
      ...(preferredFragments.length > 0 ? { preferredFragments } : {}),
      ...(pathTemplate ? { pathTemplate } : {}),
      ...(mergedQueryContains.length > 0
        ? { queryContains: mergedQueryContains }
        : {}),
      ...(replacementPairs && replacementPairs.length > 0
        ? { replacementPairs }
        : {}),
      ...(urlTemplate ? { urlTemplate } : {}),
    };
    return {
      behavioralKind: guardedBehavior ? "guarded_policy" : "avoidance",
      enactmentSurface: "text_response",
      applicability: {
        ...applicability,
        ...(createTextResponseEnactmentPlan({
          behavioralKind: guardedBehavior ? "guarded_policy" : "avoidance",
          applicability,
        })
          ? {
              textResponsePlan: createTextResponseEnactmentPlan({
                behavioralKind: guardedBehavior ? "guarded_policy" : "avoidance",
                applicability,
              }),
            }
          : {}),
      },
      transferMode,
    };
  }

  if (input.kind === "do" && !queryContains) {
    const applicability: BehavioralPolicyApplicability = {
      appliesTo,
      ...(backupMention ? { backupMention } : {}),
      ...(fallbackInstruction ? { fallbackInstruction } : {}),
      ...(computedResponseRule ? { computedResponseRule } : {}),
      ...(forbiddenFragments.length > 0 ? { forbiddenFragments } : {}),
      ...(guard ? { guard } : {}),
      ...(guardedBehavior ? { guardedBehavior } : {}),
      ...(preferredAlternatives.length > 0 ? { preferredAlternatives } : {}),
      ...(preferredFragments.length > 0 ? { preferredFragments } : {}),
      ...(pathTemplate ? { pathTemplate } : {}),
      ...(mergedQueryContains.length > 0
        ? { queryContains: mergedQueryContains }
        : {}),
      ...(replacementPairs && replacementPairs.length > 0
        ? { replacementPairs }
        : {}),
      ...(urlTemplate ? { urlTemplate } : {}),
    };
    return {
      behavioralKind: guardedBehavior ? "guarded_policy" : "transformation_rule",
      enactmentSurface: "text_response",
      applicability: {
        ...applicability,
        ...(createTextResponseEnactmentPlan({
          behavioralKind: guardedBehavior ? "guarded_policy" : "transformation_rule",
          applicability,
        })
          ? {
              textResponsePlan: createTextResponseEnactmentPlan({
                behavioralKind: guardedBehavior ? "guarded_policy" : "transformation_rule",
                applicability,
              }),
            }
          : {}),
      },
      transferMode: generalRule ? "general" : "pattern_bounded",
    };
  }

  if (generalRule || (input.exemplarCount ?? 0) >= 2) {
    const applicability: BehavioralPolicyApplicability = {
      appliesTo,
      ...(backupMention ? { backupMention } : {}),
      ...(fallbackInstruction ? { fallbackInstruction } : {}),
      ...(computedResponseRule ? { computedResponseRule } : {}),
      ...(forbiddenFragments.length > 0 ? { forbiddenFragments } : {}),
      ...(guard ? { guard } : {}),
      ...(guardedBehavior ? { guardedBehavior } : {}),
      ...(preferredAlternatives.length > 0 ? { preferredAlternatives } : {}),
      ...(preferredFragments.length > 0 ? { preferredFragments } : {}),
      ...(pathTemplate ? { pathTemplate } : {}),
      ...(mergedQueryContains.length > 0
        ? { queryContains: mergedQueryContains }
        : {}),
      ...(replacementPairs && replacementPairs.length > 0
        ? { replacementPairs }
        : {}),
      ...(urlTemplate ? { urlTemplate } : {}),
    };
    return {
      behavioralKind: guardedBehavior ? "guarded_policy" : "transformation_rule",
      enactmentSurface: "text_response",
      applicability: {
        ...applicability,
        ...(createTextResponseEnactmentPlan({
          behavioralKind: guardedBehavior ? "guarded_policy" : "transformation_rule",
          applicability,
        })
          ? {
              textResponsePlan: createTextResponseEnactmentPlan({
                behavioralKind: guardedBehavior ? "guarded_policy" : "transformation_rule",
                applicability,
              }),
            }
          : {}),
      },
      transferMode: generalRule ? "general" : "pattern_bounded",
    };
  }

  const applicability: BehavioralPolicyApplicability = {
    appliesTo,
    ...(backupMention ? { backupMention } : {}),
    ...(fallbackInstruction ? { fallbackInstruction } : {}),
    ...(computedResponseRule ? { computedResponseRule } : {}),
    ...(forbiddenFragments.length > 0 ? { forbiddenFragments } : {}),
    ...(guard ? { guard } : {}),
    ...(guardedBehavior ? { guardedBehavior } : {}),
    ...(preferredAlternatives.length > 0 ? { preferredAlternatives } : {}),
    ...(preferredFragments.length > 0 ? { preferredFragments } : {}),
    ...(pathTemplate ? { pathTemplate } : {}),
    ...(mergedQueryContains.length > 0
      ? { queryContains: mergedQueryContains }
      : {}),
    ...(replacementPairs && replacementPairs.length > 0
      ? { replacementPairs }
      : {}),
    ...(urlTemplate ? { urlTemplate } : {}),
  };
  return {
    behavioralKind: "exemplar_fact",
    enactmentSurface: "text_response",
    applicability: {
      ...applicability,
      ...(createTextResponseEnactmentPlan({
        behavioralKind: "exemplar_fact",
        applicability,
      })
        ? {
            textResponsePlan: createTextResponseEnactmentPlan({
              behavioralKind: "exemplar_fact",
              applicability,
            }),
          }
        : {}),
    },
    transferMode: "example_only",
  };
}

function countMatchedPhrases(
  haystack: string,
  phrases: readonly string[] | undefined,
): string[] {
  if (!phrases || phrases.length === 0) {
    return [];
  }

  const normalizedHaystack = normalizeText(haystack);
  return phrases.filter((phrase) => normalizedHaystack.includes(normalizeText(phrase)));
}

function uniqueReplacementPairs(
  values: Iterable<BehavioralPolicyReplacement | undefined>,
): BehavioralPolicyReplacement[] {
  const deduped: BehavioralPolicyReplacement[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }
    const identity = `${value.from}\u0000${value.to}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduped.push(value);
  }

  return deduped;
}

function selectTransientFeedbackPolicies(
  input: BehavioralPolicySelectionInput,
): BehavioralPolicySelection[] {
  if (
    !input.transientFeedback ||
    input.transientFeedback.length === 0
  ) {
    return [];
  }

  const normalizedAppliesTo = normalizeFeedbackAppliesTo(input.appliesTo);
  const normalizedQuery = normalizeText(input.query);
  const selections: BehavioralPolicySelection[] = [];

  for (const feedback of input.transientFeedback) {
    if (feedback.lifecycle !== "active" || feedback.kind === "validated_pattern") {
      continue;
    }
    if (readBehavioralPolicyFromFeedbackMemory(feedback)) {
      continue;
    }

    const policy = deriveRuleBehavioralPolicy({
      appliesTo: feedback.appliesTo,
      exemplarCount: 1,
      kind: feedback.kind,
      rule: feedback.rule,
    });
    if (policy.enactmentSurface !== input.surface) {
      continue;
    }

    const policyAppliesTo = normalizeFeedbackAppliesTo(
      policy.applicability.appliesTo ?? feedback.appliesTo,
    );
    const exactScopeMatch = policyAppliesTo === normalizedAppliesTo;
    if (!exactScopeMatch && policyAppliesTo !== "general_response") {
      continue;
    }

    const matchedQueryTokens = uniqueStrings([
      ...countMatchedPhrases(normalizedQuery, policy.applicability.queryContains),
      ...countMatchedPhrases(
        normalizedQuery,
        policy.applicability.actionSummaryContains,
      ),
      ...countMatchedPhrases(
        normalizedQuery,
        policy.applicability.forbiddenFragments,
      ),
      ...countMatchedPhrases(
        normalizedQuery,
        policy.applicability.preferredFragments,
      ),
    ]);
    const allowStructuredCurrentTurnControl =
      matchedQueryTokens.length === 0 &&
      (input.surface === "text_response"
        ? hasStructuredTextResponseSteering(policy)
        : hasStructuredHostActionSteering(policy)) &&
      (policy.applicability.queryContains?.length ?? 0) === 0;
    if (
      policy.transferMode !== "general" &&
      matchedQueryTokens.length === 0 &&
      !allowStructuredCurrentTurnControl
    ) {
      continue;
    }

    const score =
      (exactScopeMatch ? 10_000 : 0) +
      BEHAVIORAL_KIND_RANK[policy.behavioralKind] * 100 +
      TRANSFER_MODE_RANK[policy.transferMode] * 10 +
      matchedQueryTokens.length +
      (allowStructuredCurrentTurnControl ? 3 : 0) +
      5;

    selections.push({
      feedback,
      matchedQueryTokens,
      policy,
      score,
    });
  }

  return selections;
}

export function selectBehavioralPolicies(
  input: BehavioralPolicySelectionInput,
): BehavioralPolicySelection[] {
  const normalizedAppliesTo = normalizeFeedbackAppliesTo(input.appliesTo);
  const normalizedQuery = normalizeText(input.query);
  const selections: BehavioralPolicySelection[] = [];

  for (const feedback of input.feedback ?? []) {
    if (feedback.lifecycle !== "active") {
      continue;
    }

    const policy = readBehavioralPolicyFromFeedbackMemory(feedback);
    if (!policy || policy.enactmentSurface !== input.surface) {
      continue;
    }

    const policyAppliesTo = normalizeFeedbackAppliesTo(
      policy.applicability.appliesTo ?? feedback.appliesTo,
    );
    const exactScopeMatch = policyAppliesTo === normalizedAppliesTo;
    if (!exactScopeMatch && policyAppliesTo !== "general_response") {
      continue;
    }

    const matchedQueryTokens = uniqueStrings([
      ...countMatchedPhrases(normalizedQuery, policy.applicability.queryContains),
      ...countMatchedPhrases(
        normalizedQuery,
        policy.applicability.actionSummaryContains,
      ),
      ...countMatchedPhrases(
        normalizedQuery,
        policy.applicability.forbiddenFragments,
      ),
      ...countMatchedPhrases(
        normalizedQuery,
        policy.applicability.preferredFragments,
      ),
    ]);
    if (
      policy.transferMode === "example_only" &&
      matchedQueryTokens.length === 0
    ) {
      continue;
    }

    const score =
      (exactScopeMatch ? 10_000 : 0) +
      (input.surface === "host_action" && policy.enactmentSurface === "host_action"
        ? 2_000
        : 0) +
      BEHAVIORAL_KIND_RANK[policy.behavioralKind] * 100 +
      TRANSFER_MODE_RANK[policy.transferMode] * 10 +
      matchedQueryTokens.length;

    selections.push({
      feedback,
      matchedQueryTokens,
      policy,
      score,
    });
  }

  const transientSelections = selectTransientFeedbackPolicies(input);

  return [...selections, ...transientSelections].sort(
    (left, right) => right.score - left.score,
  );
}

function uniqueOperations(
  operations: readonly TextResponseEnactmentOperation[],
): TextResponseEnactmentOperation[] {
  const seen = new Set<string>();
  const deduped: TextResponseEnactmentOperation[] = [];

  for (const operation of operations) {
    const identity = JSON.stringify(operation);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduped.push(operation);
  }

  return deduped;
}

export function resolveTextResponseEnactmentPlan(
  policies: readonly BehavioralPolicySelection[],
): TextResponseEnactmentPlan | undefined {
  return resolveTextResponseEnactmentPlanFromPolicies(
    policies.map((selection) => selection.policy),
  );
}

export function resolveTextResponseEnactmentPlanFromPolicies(
  policies: readonly BehavioralPolicy[],
): TextResponseEnactmentPlan | undefined {
  const operations = uniqueOperations(
    policies.flatMap((policy) => {
      if (policy.enactmentSurface !== "text_response") {
        return [];
      }

      return (
        policy.applicability.textResponsePlan?.operations ??
        createTextResponseEnactmentPlan({
          behavioralKind: policy.behavioralKind,
          applicability: policy.applicability,
        })?.operations ??
        []
      );
    },
    ),
  );

  if (operations.length === 0) {
    return undefined;
  }
  const brevityOnly = policies.some(
    (policy) => policy.applicability.textResponsePlan?.brevityOnly === true,
  );
  const bulletOnly = policies.some(
    (policy) => policy.applicability.textResponsePlan?.bulletOnly === true,
  );

  return {
    ...(bulletOnly ? { bulletOnly: true } : {}),
    ...(brevityOnly ? { brevityOnly: true } : {}),
    concise: true,
    operations,
  };
}

function renderTextResponseEnactmentOperation(
  operation: TextResponseEnactmentOperation,
): string[] {
  switch (operation.kind) {
    case "rewrite_output_slot":
      return [
        operation.computedResponseRule
          ? operation.computedResponseRule.kind === "recurrence"
            ? `rewrite_output_slot recurrence_rule: ${operation.computedResponseRule.sequenceName}(n) = ${operation.computedResponseRule.expression}`
            : `rewrite_output_slot binary_rule: ${operation.computedResponseRule.leftVariable} ${operation.computedResponseRule.operatorSymbol} ${operation.computedResponseRule.rightVariable} = ${operation.computedResponseRule.expression}`
          : undefined,
        operation.replacementPairs && operation.replacementPairs.length > 0
          ? `rewrite_output_slot replacements: ${operation.replacementPairs
              .map((entry) => `${entry.from} -> ${entry.to}`)
              .join(", ")}`
          : undefined,
        operation.urlTemplate
          ? `rewrite_output_slot url_template: keep ${operation.urlTemplate.scheme}://${operation.urlTemplate.host} and place the requested page after the host as a path segment`
          : undefined,
        operation.pathTemplate
          ? `rewrite_output_slot path_template: keep safe anchor ${operation.pathTemplate.anchor} and preserve the requested filename`
          : undefined,
        operation.exactFragments?.prefixes?.length
          ? `rewrite_output_slot prefix: ${operation.exactFragments.prefixes[0]}`
          : undefined,
        operation.exactFragments?.suffixes?.length
          ? `rewrite_output_slot suffix: ${operation.exactFragments.suffixes[0]}`
          : undefined,
      ].filter((entry): entry is string => Boolean(entry));
    case "block_surface":
      return [
        `block_surface forbidden: ${operation.forbiddenFragments.join(", ")}`,
        operation.fallbackAnswer
          ? `block_surface fallback: ${operation.fallbackAnswer}`
          : undefined,
      ].filter((entry): entry is string => Boolean(entry));
    case "require_warning":
      return [
        `require_warning: ${operation.warningMessage}`,
        operation.preferredAlternatives && operation.preferredAlternatives.length > 0
          ? `warning_alternatives: ${operation.preferredAlternatives.join(", ")}`
          : undefined,
        operation.backupMention
          ? `warning_backup: ${operation.backupMention}`
          : undefined,
      ].filter((entry): entry is string => Boolean(entry));
    case "require_precondition_check":
      return [
        `require_precondition_check: ${operation.precondition}`,
        operation.allowedWhen && operation.allowedWhen.length > 0
          ? `allowed_when: ${operation.allowedWhen.join(" or ")}`
          : undefined,
        `fallback_behavior: ${operation.fallbackBehavior.warningMessage}`,
      ].filter((entry): entry is string => Boolean(entry));
  }
}

export function buildStructuredTextResponseControlLines(
  plan: TextResponseEnactmentPlan | undefined,
): string[] {
  if (!plan) {
    return [];
  }

  return uniqueStrings(
    [
      ...(plan.brevityOnly
        ? ["brevity_only: emit only the answer surface with no extra explanation"]
        : []),
      ...(plan.bulletOnly
        ? ["bullet_only: emit a terse bullet list with no paragraph preface"]
        : []),
      ...plan.operations.flatMap((operation) =>
        renderTextResponseEnactmentOperation(operation),
      ),
    ],
  );
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function replaceAllLiteralInsensitive(
  value: string,
  search: string,
  replacement: string,
): string {
  if (search.length === 0) {
    return value;
  }

  return value.replace(new RegExp(escapeRegExpLiteral(search), "giu"), replacement);
}

function replaceForbiddenSurface(
  value: string,
  fragment: string,
  replacement: string,
): string {
  if (/^[A-Za-z]+$/u.test(fragment)) {
    return value.replace(
      new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExpLiteral(fragment)}(?![\\p{L}\\p{N}_])`, "giu"),
      replacement,
    );
  }

  return replaceAllLiteralInsensitive(value, fragment, replacement);
}

function containsForbiddenSurface(value: string, fragment: string): boolean {
  if (/^[A-Za-z]+$/u.test(fragment)) {
    return new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExpLiteral(fragment)}(?![\\p{L}\\p{N}_])`,
      "iu",
    ).test(value);
  }

  return normalizeText(value).includes(normalizeText(fragment));
}

function extractRequestedFilename(value: string): string | undefined {
  const matches = [...value.matchAll(/(?:~\/|\/)[A-Za-z0-9._/-]*\/([A-Za-z0-9._-]+)/gu)];
  return matches.at(-1)?.[1]?.replace(/[.,;:!?]+$/u, "");
}

function extractRequestedPageSegment(value: string): string | undefined {
  const urlMatch = value.match(/https?:\/\/[^\s)]+/u);
  if (urlMatch?.[0]) {
    try {
      const parsed = new URL(urlMatch[0]);
      const pathSegments = parsed.pathname.split("/").filter(Boolean);
      if (pathSegments.length > 0) {
        return pathSegments.at(-1);
      }
      const subdomain = parsed.hostname.replace(/\.[^.]+\.[^.]+$/u, "");
      if (subdomain.length > 0 && !subdomain.includes(".")) {
        return subdomain;
      }
    } catch {
      return undefined;
    }
  }

  return analyzeBehavioralText(value)?.namedTarget;
}

function rewriteUrlsToTemplate(
  answer: string,
  query: string | undefined,
  template: BehavioralPolicyUrlTemplate,
): string {
  const requestedPage = extractRequestedPageSegment(query ?? answer);

  return answer.replace(/https?:\/\/[^\s)]+/gu, (matched) => {
    try {
      const parsed = new URL(matched);
      const pathSegments = parsed.pathname.split("/").filter(Boolean);
      const subdomain = parsed.hostname.endsWith(`.${template.host}`)
        ? parsed.hostname.slice(0, -(`.${template.host}`).length)
        : "";
      const page =
        requestedPage ??
        pathSegments.at(-1) ??
        (subdomain.length > 0 ? subdomain.split(".").at(-1) : undefined);
      if (!page) {
        return `${template.scheme}://${template.host}`;
      }
      return `${template.scheme}://${template.host}/${page}`;
    } catch {
      return matched;
    }
  });
}

function rewritePathsToTemplate(
  answer: string,
  query: string | undefined,
  template: BehavioralPolicyPathTemplate,
): string {
  const requestedFilename = extractRequestedFilename(query ?? answer);
  if (!requestedFilename) {
    return answer;
  }

  return answer.replace(
    /(?:~\/|\/)[A-Za-z0-9._/-]*\/([A-Za-z0-9._-]+)/gu,
    () => `${template.anchor}${requestedFilename}`,
  );
}

function buildPathReplacementFromQuery(
  query: string | undefined,
  template: BehavioralPolicyPathTemplate,
): string | undefined {
  const requestedFilename = query ? extractRequestedFilename(query) : undefined;
  return requestedFilename ? `${template.anchor}${requestedFilename}` : undefined;
}

function extractPrimaryUnsafePathFromQuery(
  query: string | undefined,
  template: BehavioralPolicyPathTemplate,
): string | undefined {
  if (!query) {
    return undefined;
  }

  const matches = [...query.matchAll(/(?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9._-]/gu)]
    .map((match) => match[0]?.trim())
    .filter((entry): entry is string => Boolean(entry));

  return matches.find((path) => !path.startsWith(template.anchor));
}

function buildUrlReplacementFromQuery(
  query: string | undefined,
  template: BehavioralPolicyUrlTemplate,
): string | undefined {
  const requestedPage = query ? extractRequestedPageSegment(query) : undefined;
  return requestedPage
    ? `${template.scheme}://${template.host}/${requestedPage}`
    : undefined;
}

function looksLikeWarningAnswer(value: string): boolean {
  return analyzeBehavioralText(value)?.warningSignal === true;
}

function mentionsPrecondition(answer: string, precondition: string): boolean {
  return normalizeText(answer).includes(normalizeText(precondition));
}

function mentionsAllowedWhen(
  answer: string,
  allowedWhen: readonly string[] | undefined,
): boolean {
  if (!allowedWhen || allowedWhen.length === 0) {
    return false;
  }

  const normalizedAnswer = normalizeText(answer);
  return allowedWhen.some((value) => normalizedAnswer.includes(normalizeText(value)));
}

function buildAnalogyFallbackAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (/\blike\b/iu.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.endsWith("?")) {
    return "Think of it like a familiar everyday helper that connects the pieces for you.";
  }

  return `Think of it like this: ${trimmed}`.trim();
}

function formatComputedNumericResult(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)));
}

function evaluateArithmeticExpression(input: {
  expression: string;
  scope: Record<string, number>;
}): number | undefined {
  let rewritten = input.expression.replace(/\^/gu, "**");
  for (const [name, value] of Object.entries(input.scope).sort(
    ([left], [right]) => right.length - left.length,
  )) {
    rewritten = rewritten.replace(
      new RegExp(`\\b${escapeRegExpLiteral(name)}\\b`, "gu"),
      `(${value})`,
    );
  }

  if (/[^0-9+\-*/().\s*]/u.test(rewritten)) {
    return undefined;
  }

  try {
    const result = Function(`"use strict"; return (${rewritten});`)();
    return typeof result === "number" && Number.isFinite(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function extractRecurrenceQueryBaseCases(input: {
  query: string;
  sequenceName: string;
}): Map<number, number> {
  const baseCases = new Map<number, number>();
  for (const match of input.query.matchAll(
    new RegExp(
      `${escapeRegExpLiteral(input.sequenceName)}\\((-?\\d+)\\)\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`,
      "gu",
    ),
  )) {
    const index = Number(match[1]);
    const value = Number(match[2]);
    if (!Number.isInteger(index) || !Number.isFinite(value)) {
      continue;
    }
    baseCases.set(index, value);
  }
  return baseCases;
}

function evaluateRecurrenceComputedRule(input: {
  query: string;
  rule: BehavioralPolicyComputedRecurrenceRule;
}): string | undefined {
  const targetMatch = input.query.match(
    new RegExp(
      `${escapeRegExpLiteral(input.rule.sequenceName)}\\((-?\\d+)\\)(?!\\s*=)`,
      "u",
    ),
  );
  if (!targetMatch?.[1]) {
    return undefined;
  }

  const targetIndex = Number(targetMatch[1]);
  if (!Number.isInteger(targetIndex)) {
    return undefined;
  }

  const memo = new Map<number, number>();
  for (const entry of input.rule.baseCases ?? []) {
    memo.set(entry.index, entry.value);
  }
  for (const [index, value] of extractRecurrenceQueryBaseCases({
    query: input.query,
    sequenceName: input.rule.sequenceName,
  })) {
    memo.set(index, value);
  }

  const evaluating = new Set<number>();
  const recurrenceRefRe = new RegExp(
    `${escapeRegExpLiteral(input.rule.sequenceName)}\\(n\\s*([+-])\\s*(\\d+)\\)`,
    "gu",
  );

  const evaluateIndex = (index: number): number | undefined => {
    if (memo.has(index)) {
      return memo.get(index);
    }
    if (evaluating.has(index)) {
      return undefined;
    }
    evaluating.add(index);

    let expression = input.rule.expression.replace(
      recurrenceRefRe,
      (_whole, sign: string, offsetRaw: string) => {
        const offset = Number(offsetRaw);
        if (!Number.isInteger(offset)) {
          return "NaN";
        }
        const referencedIndex = sign === "+" ? index + offset : index - offset;
        const referencedValue = evaluateIndex(referencedIndex);
        return referencedValue === undefined ? "NaN" : `(${referencedValue})`;
      },
    );

    expression = expression.replace(/\bn\b/gu, `(${index})`);
    const result = evaluateArithmeticExpression({
      expression,
      scope: {},
    });
    evaluating.delete(index);
    if (result === undefined) {
      return undefined;
    }
    memo.set(index, result);
    return result;
  };

  const result = evaluateIndex(targetIndex);
  return result === undefined ? undefined : formatComputedNumericResult(result);
}

function evaluateBinaryOperatorComputedRule(input: {
  query: string;
  rule: BehavioralPolicyComputedBinaryOperatorRule;
}): string | undefined {
  const operatorMatch = input.query.match(
    new RegExp(
      `(-?\\d+(?:\\.\\d+)?)\\s*${escapeRegExpLiteral(input.rule.operatorSymbol)}\\s*(-?\\d+(?:\\.\\d+)?)`,
      "u",
    ),
  );
  if (!operatorMatch?.[1] || !operatorMatch[2]) {
    return undefined;
  }

  const leftValue = Number(operatorMatch[1]);
  const rightValue = Number(operatorMatch[2]);
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
    return undefined;
  }

  const result = evaluateArithmeticExpression({
    expression: input.rule.expression,
    scope: {
      [input.rule.leftVariable]: leftValue,
      [input.rule.rightVariable]: rightValue,
    },
  });
  return result === undefined ? undefined : formatComputedNumericResult(result);
}

export function evaluateComputedResponseRule(input: {
  query: string | undefined;
  rule: BehavioralPolicyComputedResponseRule | undefined;
}): string | undefined {
  if (!input.query || !input.rule) {
    return undefined;
  }

  switch (input.rule.kind) {
    case "recurrence":
      return evaluateRecurrenceComputedRule({
        query: input.query,
        rule: input.rule,
      });
    case "binary_operator":
      return evaluateBinaryOperatorComputedRule({
        query: input.query,
        rule: input.rule,
      });
  }
}

function applyRequiredFragment(answer: string, fragment: string): string {
  if (answer.includes(fragment)) {
    return answer;
  }

  if (/^(Subject:|Reference:|Purpose:|CC:)/iu.test(fragment)) {
    const lines = answer
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const headerBoundary = lines.findIndex(
      (line) => !/^(Subject:|Reference:|Purpose:|CC:)/iu.test(line),
    );
    if (headerBoundary === -1) {
      return [fragment, ...lines].join("\n").trim();
    }
    return [
      ...lines.slice(0, headerBoundary),
      fragment,
      ...lines.slice(headerBoundary),
    ]
      .join("\n")
      .trim();
  }

  if (
    fragment.startsWith("Dear ") ||
    /^(Hello|Hi|Greetings|To whom it may concern,)/iu.test(fragment)
  ) {
    if (/^(Subject:|Reference:|Purpose:|CC:)/iu.test(answer)) {
      const lines = answer
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const headerBoundary = lines.findIndex(
        (line) => !/^(Subject:|Reference:|Purpose:|CC:)/iu.test(line),
      );
      if (headerBoundary === -1) {
        return [...lines, fragment].join("\n").trim();
      }
      return [
        ...lines.slice(0, headerBoundary),
        fragment,
        ...lines.slice(headerBoundary),
      ]
        .join("\n")
        .trim();
    }
    return `${fragment}\n${answer}`.trim();
  }

  if (fragment.includes("\n")) {
    const [firstLine] = fragment.split(/\r?\n/u);
    if (/(?:regards|respectfully|sincerely|thanks)\b/iu.test(firstLine)) {
      const bareSignoff = new RegExp(
        `${escapeRegExpLiteral(firstLine)}\\s*$`,
        "u",
      );
      const withoutBareSignoff = answer.replace(bareSignoff, "").trimEnd();
      return `${withoutBareSignoff}\n\n${fragment}`.trim();
    }
  }

  if (
    /(?:regards|respectfully|sincerely|thanks)\b/iu.test(fragment) &&
    fragment.endsWith(",")
  ) {
    return `${answer}\n\n${fragment}`.trim();
  }

  return `${answer} ${fragment}`.trim();
}

function slashPathToPipePath(path: string): string {
  if (path.startsWith("~/")) {
    const segments = path.slice(2).split("/").filter(Boolean);
    return segments.length > 0 ? `|~|${segments.join("|")}|` : "|~|";
  }

  if (path.startsWith("/")) {
    const segments = path.split("/").filter(Boolean);
    return segments.length > 0 ? `|${segments.join("|")}|` : "|/|";
  }

  return `|${path}|`;
}

function extractPipeWrappedTarget(query: string | undefined): string | undefined {
  if (!query) {
    return undefined;
  }

  return (analyzeBehavioralText(query)?.namedTarget ?? extractQuotedValues(query)[0])
    ?.trim()
    .replace(/[.,;:!?]+$/u, "");
}

function extractPipePathTarget(query: string | undefined): string | undefined {
  if (!query) {
    return undefined;
  }

  const analysis = analyzeBehavioralText(query);
  const basePath = analysis?.pathBase;
  const namedTarget = analysis?.namedTarget;
  const sanitizedBasePath = basePath?.replace(/[.,;:!?]+$/u, "");
  const sanitizedNamedTarget = namedTarget?.replace(/[.,;:!?]+$/u, "");

  if (sanitizedBasePath) {
    const path = sanitizedBasePath.endsWith("/")
      ? `${sanitizedBasePath}${sanitizedNamedTarget ?? ""}`.replace(/\/+$/u, "")
      : sanitizedNamedTarget
        ? `${sanitizedBasePath}/${sanitizedNamedTarget}`
        : sanitizedBasePath;
    return slashPathToPipePath(path);
  }

  const folder = extractPipeWrappedTarget(query);
  return folder ? slashPathToPipePath(folder) : undefined;
}

function extractStructuredLiteral(query: string | undefined): string | undefined {
  return extractQuotedValues(query ?? "")[0]?.trim();
}

function extractSanitizedToken(
  query: string | undefined,
  template?: string,
): string | undefined {
  const raw = extractStructuredLiteral(query);
  if (!raw) {
    return undefined;
  }
  const usesUnderscoreTokenSlot =
    /_<token>|<token>_/u.test(template ?? "");
  const sanitized = usesUnderscoreTokenSlot
    ? raw.replace(/[^A-Za-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "")
    : raw.replace(/[^A-Za-z0-9]/gu, "");
  return sanitized && sanitized.length > 0 ? sanitized : undefined;
}

function extractStructuredTerms(query: string | undefined): string | undefined {
  if (!query) {
    return undefined;
  }

  return analyzeBehavioralText(query)?.structuredTerms?.join(" ");
}

function extractFilterField(query: string | undefined): string | undefined {
  if (!query) {
    return undefined;
  }

  return analyzeBehavioralText(query)?.comparison?.field;
}

function extractComparisonOperator(query: string | undefined): string | undefined {
  return analyzeBehavioralText(query)?.comparison?.operator;
}

function quoteComparisonValueIfNeeded(value: string): string {
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return value;
  }
  if (/^['"].*['"]$/u.test(value)) {
    return value;
  }
  return `'${value}'`;
}

function sanitizeComparisonLiteral(value: string): string {
  return value
    .replace(/^['"]|['"]$/gu, "")
    .replace(/[.,;:!?]+$/u, "");
}

function extractComparisonValue(query: string | undefined): string | undefined {
  if (!query) {
    return undefined;
  }

  const explicit = analyzeBehavioralText(query)?.comparison?.value;
  if (explicit) {
    return quoteComparisonValueIfNeeded(sanitizeComparisonLiteral(explicit));
  }

  return undefined;
}

function recoverPipedFilterAction(
  raw: string,
  query: string | undefined,
): string | undefined {
  if (!query) {
    return undefined;
  }
  const match = raw.match(
    /^(.+\|\s*FILTER\s+)[A-Za-z_][A-Za-z0-9_.-]*\s*(?:>=|<=|=|>|<)\s*.+$/iu,
  );
  if (!match?.[1]) {
    return undefined;
  }
  const field = extractFilterField(query);
  const operator = extractComparisonOperator(query);
  const value = extractComparisonValue(query);
  if (!field || !operator || !value) {
    return undefined;
  }
  return `${match[1]}${field} ${operator} ${value}`;
}

function fillStructuredActionTemplate(
  raw: string,
  query: string | undefined,
): string | undefined {
  let recovered = raw;

  if (recovered.includes("|folder|")) {
    const folder = extractPipeWrappedTarget(query);
    if (!folder) {
      return undefined;
    }
    recovered = recovered.replace(/\|folder\|/gu, slashPathToPipePath(folder));
  }

  if (recovered.includes("|path|")) {
    const pipePath = extractPipePathTarget(query);
    if (!pipePath) {
      return undefined;
    }
    recovered = recovered.replace(/\|path\|/gu, pipePath);
  }

  if (recovered.includes("<filename>")) {
    const filename = extractStructuredLiteral(query);
    if (!filename) {
      return undefined;
    }
    recovered = recovered.replace(/<filename>/gu, filename);
  }

  if (recovered.includes("<id>")) {
    const identifier = extractStructuredLiteral(query);
    if (!identifier) {
      return undefined;
    }
    recovered = recovered.replace(/<id>/gu, identifier);
  }

  if (recovered.includes("<item>")) {
    const item = extractStructuredLiteral(query);
    if (!item) {
      return undefined;
    }
    recovered = recovered.replace(/<item>/gu, item);
  }

  if (recovered.includes("<qty>")) {
    const qty =
      query?.match(/\bqty\b[^0-9]*([0-9]+)/iu)?.[1] ??
      query?.match(/\b([0-9]+)\b/u)?.[1];
    if (!qty) {
      return undefined;
    }
    recovered = recovered.replace(/<qty>/gu, qty);
  }

  if (recovered.includes("<terms>")) {
    const terms = extractStructuredTerms(query);
    if (!terms) {
      return undefined;
    }
    recovered = recovered.replace(/<terms>/gu, terms);
  }

  if (recovered.includes("<token>")) {
    const token = extractSanitizedToken(query, recovered);
    if (!token) {
      return undefined;
    }
    recovered = recovered.replace(/<token>/gu, token);
  }

  if (recovered.includes("<field>")) {
    const field = extractFilterField(query);
    if (!field) {
      return undefined;
    }
    recovered = recovered.replace(/<field>/gu, field);
  }

  if (recovered.includes("<operator>")) {
    const operator = extractComparisonOperator(query);
    if (!operator) {
      return undefined;
    }
    recovered = recovered.replace(/<operator>/gu, operator);
  }

  if (recovered.includes("<value>")) {
    const value = extractComparisonValue(query);
    if (!value) {
      return undefined;
    }
    recovered = recovered.replace(/<value>/gu, value);
  }

  return /<[^>]+>/u.test(recovered) ? undefined : recovered;
}

function buildSingleQuotedArg(value: string): string {
  return `'${value.replaceAll("'", "\\'")}'`;
}

function looksLikeDirectoryPath(value: string): boolean {
  return value.endsWith("/");
}

function appendFilenameToDirectory(directory: string, sourcePath: string): string {
  if (!looksLikeDirectoryPath(directory)) {
    return directory;
  }

  const filename = sourcePath.split("/").filter(Boolean).at(-1);
  return filename ? `${directory}${filename}` : directory;
}

function extractNamedToolCallValue(input: {
  argumentLabel: string;
  destinationPath?: string;
  hostAction: NonNullable<LanguageBehavioralRuleAnalysis["hostAction"]>;
  sourcePaths: string[];
  usedSourceCount: number;
}): string | undefined {
  const label = normalizeText(input.argumentLabel);
  const nextSource = input.sourcePaths[input.usedSourceCount];

  if (label.includes("action")) {
    const verb = input.hostAction.verb;
    return verb ? buildSingleQuotedArg(verb) : undefined;
  }

  if (label.includes("owner")) {
    const owner = input.hostAction.owner;
    return owner ? buildSingleQuotedArg(owner) : undefined;
  }

  if (label.includes("permission") || label.includes("perms")) {
    const permissions = input.hostAction.permissions;
    return permissions ? buildSingleQuotedArg(permissions) : undefined;
  }

  if (label.includes("compression")) {
    const compression = input.hostAction.compression;
    return compression ? buildSingleQuotedArg(compression) : undefined;
  }

  if (label.includes("flags")) {
    const flags = input.hostAction.flags ?? [];
    if (flags.length === 0) {
      return undefined;
    }
    return `[${flags.map((value) => buildSingleQuotedArg(value)).join(",")}]`;
  }

  if (label.includes("tag")) {
    const tag = input.hostAction.tag;
    return tag ? buildSingleQuotedArg(tag) : undefined;
  }

  if (label.includes("mode")) {
    const mode = input.hostAction.mode;
    return mode ? buildSingleQuotedArg(mode) : undefined;
  }

  if (label.includes("sources")) {
    if (input.sourcePaths.length === 0) {
      return undefined;
    }
    return `[${input.sourcePaths.map((value) => buildSingleQuotedArg(value)).join(",")}]`;
  }

  if (label.includes("source")) {
    return nextSource ? buildSingleQuotedArg(nextSource) : undefined;
  }

  if (
    label.includes("destination") ||
    label.includes("target") ||
    label.includes("archive")
  ) {
    const destination = input.destinationPath;
    if (!destination) {
      return undefined;
    }
    const sourceForFilename = input.sourcePaths[0];
    const expectsDirectoryTarget =
      /\b(?:directory|folder|root)\b/iu.test(label) ||
      /(?:^|_)dir(?:_|$)/iu.test(label);
    return buildSingleQuotedArg(
      sourceForFilename && !expectsDirectoryTarget
        ? appendFilenameToDirectory(destination, sourceForFilename)
        : destination,
    );
  }

  return undefined;
}

function recoverNamedToolCallAction(
  policy: BehavioralPolicy,
  query: string,
): BehavioralPolicyAction | undefined {
  const canonicalFirstAction = policy.applicability.canonicalFirstAction;
  if (
    canonicalFirstAction?.kind !== "tool_call" ||
    !canonicalFirstAction.name ||
    !canonicalFirstAction.args ||
    canonicalFirstAction.args.length === 0
  ) {
    return canonicalFirstAction;
  }

  const hostAction = analyzeBehavioralText(query)?.hostAction;
  if (!hostAction) {
    return canonicalFirstAction;
  }
  const sourcePaths = hostAction.sources ?? [];
  const destinationPath = hostAction.destination;
  const recoveredArgs: string[] = [];
  let usedSourceCount = 0;
  for (const argumentLabel of canonicalFirstAction.args) {
    const recovered = extractNamedToolCallValue({
      argumentLabel,
      destinationPath,
      hostAction,
      sourcePaths,
      usedSourceCount,
    });
    if (!recovered) {
      return canonicalFirstAction;
    }
    recoveredArgs.push(recovered);
    const normalizedLabel = normalizeText(argumentLabel);
    if (normalizedLabel.includes("source") && !normalizedLabel.includes("sources")) {
      usedSourceCount += 1;
    }
  }

  return {
    args: recoveredArgs,
    kind: "tool_call",
    name: canonicalFirstAction.name,
    raw: `${canonicalFirstAction.name}(${recoveredArgs.join(", ")})`,
  };
}

function satisfiesPreferredSafeSurface(
  answer: string,
  operation: TextResponseRequireWarningOperation,
): boolean {
  if (
    operation.backupMention &&
    !/\b(?:back\s*up|backup)\b/iu.test(answer)
  ) {
    return false;
  }

  if (
    operation.preferredAlternatives?.some((alternative) => answer.includes(alternative))
  ) {
    return true;
  }

  if (operation.replacementTarget && answer.includes(operation.replacementTarget)) {
    return true;
  }

  if (operation.warningMessage.toLowerCase().includes("https") && answer.includes("https://")) {
    return true;
  }

  if (
    operation.warningMessage.toLowerCase().includes("home-directory") &&
    (answer.includes("/home/") || answer.includes("~/"))
  ) {
    return true;
  }

  return false;
}

function applyFallbackBehavior(
  fallbackBehavior: BehavioralPolicyFallbackBehavior,
): string {
  const segments = [fallbackBehavior.warningMessage];
  if (fallbackBehavior.preferredAlternatives?.length) {
    segments.push(
      `Use ${fallbackBehavior.preferredAlternatives.join(" or ")} instead.`,
    );
  }
  if (fallbackBehavior.replacementTarget) {
    segments.push(`Safe replacement: ${fallbackBehavior.replacementTarget}.`);
  }
  if (fallbackBehavior.backupMention) {
    segments.push(fallbackBehavior.backupMention);
  }

  return segments.join(" ");
}

function stripExplicitMemoryPhrasing(answer: string): string {
  return answer
    .replace(
      /^(?:developer\s+memory\s+notes?|relevant\s+prior\s+examples?|prior\s+examples?|previous\s+examples?)\s*[:\-]\s*/gimu,
      "",
    )
    .replace(/^example\s+\d+\s*[:\-]\s*/gimu, "")
    .replace(
      /\b(?:I|We)\s+remember(?:ed)?\s+(?:the\s+)?(?:earlier|previous|learned)\s+(?:rule|rules|note|notes)[,:]?\s*/gu,
      "",
    )
    .replace(
      /\b(?:according to|based on|from)\s+(?:my|our|the\s+)?(?:learned rules?|earlier notes?)\s+from\s+(?:my|our|the\s+)?memory\b[:\s,-]*/giu,
      "",
    )
    .replace(
      /\b(?:according to|based on|from)\s+(?:my|our|the\s+)?(?:memory|learned rules?|earlier notes?)\b[:\s,-]*/giu,
      "",
    )
    .replace(/\b(?:according to|based on|from)\s+(?:my|our|the\s+)?memory\b[:\s-]*/giu, "")
    .replace(/\b(?:I|We)\s+remember(?:ed)?\s+that\b/gu, "")
    .replace(/\bremembered\b/giu, "held")
    .replace(/\bremember\b/giu, "know")
    .replace(
      /\b(?:memory|earlier notes?|learned rules?|learned rule|previous examples?|prior examples?)\b/giu,
      "",
    )
    .replace(/\b(?:examples?\s+)?say\s+/giu, "")
    .replace(/^(?:according to|based on|from)\s*[,:\-]?\s*/iu, "")
    .replace(/[ \t]+/gu, " ")
    .replace(/[ \t]*\n[ \t]*/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function firstNonEmptyTextLine(value: string): string {
  return (
    value
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? value.trim()
  );
}

function stripCommandOnlyWrapper(value: string): string {
  return normalizeText(value)
    .replace(/^(?:i(?:'d| would)?\s+)?(?:use|run|send|provide|answer(?: is)?|would use)\s*:?\s*/iu, "")
    .replace(/^`([^`]+)`$/u, "$1")
    .replace(/^['"]([^'"]+)['"]$/u, "$1")
    .replace(/([A-Za-z0-9])([.。])$/u, "$1")
    .trim();
}

function formatConciseNumber(value: number): string | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value
    .toFixed(4)
    .replace(/0+$/u, "")
    .replace(/\.$/u, "");
}

function computeConciseBrevityAnswerFromQuery(query: string): string | undefined {
  const computation = analyzeBehavioralText(query)?.conciseComputation;
  if (computation?.kind === "percentage") {
    return formatConciseNumber(
      (computation.percentage * computation.base) / 100,
    );
  }
  if (computation?.kind === "circle_circumference") {
    const diameter = computation.radius * 2;
    const conciseDiameter = formatConciseNumber(diameter);
    return conciseDiameter ? `${conciseDiameter}π` : undefined;
  }
  if (computation?.kind === "iso_datetime_command") {
    return "date -Iseconds";
  }

  return undefined;
}

function extractBrevityOnlySurface(answer: string): string | undefined {
  const fenced = answer.match(/```(?:[A-Za-z0-9_-]+)?\s*\n([^`]+?)\n```/u)?.[1];
  if (fenced) {
    const fencedLine = firstNonEmptyTextLine(fenced);
    return fencedLine ? stripCommandOnlyWrapper(fencedLine) : undefined;
  }

  const inlineCode = answer.match(/`([^`]+)`/u)?.[1];
  if (inlineCode) {
    return stripCommandOnlyWrapper(inlineCode);
  }

  const firstLine = firstNonEmptyTextLine(answer);
  if (!firstLine) {
    return undefined;
  }

  const explicitAnswerMatch = firstLine.match(
    /^(?:successful\s+move|answer(?:\s+is)?)\s*:\s*(.+)$/iu,
  );
  if (explicitAnswerMatch?.[1]) {
    const concisePrefix = explicitAnswerMatch[1].split(
      /[.。]\s+(?:because|for more|it|that|this|which)\b/iu,
    )[0];
    return stripCommandOnlyWrapper(concisePrefix ?? explicitAnswerMatch[1]);
  }

  return stripCommandOnlyWrapper(firstLine.match(/:\s*(.+)$/u)?.[1] ?? firstLine);
}

function toConciseBulletList(answer: string): string {
  const existingBullets = answer
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/u.test(line))
    .slice(0, 3)
    .map((line) => line.replace(/^[-*]\s+/u, "- "));
  if (existingBullets.length > 0) {
    return existingBullets.join("\n");
  }

  const segments = answer
    .replace(/\s+/gu, " ")
    .split(/\s*(?:[.;]\s+|,\s+(?=(?:and|then|with|while|plus)\b))/iu)
    .map((segment) =>
      segment
        .replace(/^(?:the\s+)?(?:answer|summary|overview)\s+(?:is|includes)\s*/iu, "")
        .replace(/^(?:it|this|the\s+\w+)\s+/iu, "")
        .replace(/[.。]+$/u, "")
        .trim(),
    )
    .filter((segment) => segment.length > 0)
    .slice(0, 3);
  if (segments.length === 0) {
    return answer;
  }

  return segments.map((segment) => `- ${segment}`).join("\n");
}

export function applyTextResponseEnactmentPlan(input: {
  answer: string;
  plan: TextResponseEnactmentPlan | undefined;
  query?: string;
}): string {
  if (!input.plan) {
    return stripExplicitMemoryPhrasing(input.answer);
  }

  let answer = input.answer.trim();

  for (const operation of input.plan.operations) {
    switch (operation.kind) {
      case "rewrite_output_slot":
        {
          const computedAnswer = evaluateComputedResponseRule({
            query: input.query,
            rule: operation.computedResponseRule,
          });
          if (computedAnswer) {
            answer = computedAnswer;
            break;
          }
        }
        for (const replacement of operation.replacementPairs ?? []) {
          answer = replaceAllLiteralInsensitive(
            answer,
            replacement.from,
            replacement.to,
          );
        }
        if (operation.urlTemplate) {
          answer = rewriteUrlsToTemplate(answer, input.query, operation.urlTemplate);
        }
        if (operation.pathTemplate) {
          answer = rewritePathsToTemplate(answer, input.query, operation.pathTemplate);
        }
        if (operation.exactFragments?.prefixes?.[0] && !answer.startsWith(operation.exactFragments.prefixes[0])) {
          answer = `${operation.exactFragments.prefixes[0]} ${answer}`.trim();
        }
        if (operation.exactFragments?.required?.length) {
          for (const fragment of operation.exactFragments.required) {
            answer = applyRequiredFragment(answer, fragment);
          }
        }
        if (operation.preferredFragments?.length) {
          const normalizedAnswer = normalizeText(answer);
          const missingPreferredFragment = operation.preferredFragments.every(
            (fragment) => !normalizedAnswer.includes(normalizeText(fragment)),
          );
          if (missingPreferredFragment && operation.preferredFragments.some((fragment) => normalizeText(fragment) === "like")) {
            answer = buildAnalogyFallbackAnswer(answer);
          }
        }
        if (operation.exactFragments?.suffixes?.[0]) {
          const suffix = operation.exactFragments.suffixes[0];
          const normalizedAnswer = normalizeText(answer).replace(/\s+/gu, " ");
          const normalizedSuffix = normalizeText(suffix).replace(/\s+/gu, " ");
          if (!normalizedAnswer.endsWith(normalizedSuffix)) {
            answer = `${answer} ${suffix}`.trim();
          }
        }
        break;
      case "block_surface":
        {
          const hadForbiddenSurface = operation.forbiddenFragments.some((fragment) =>
            containsForbiddenSurface(answer, fragment),
          );
        for (const replacement of operation.replacementPairs ?? []) {
          answer = replaceAllLiteralInsensitive(
            answer,
            replacement.from,
            replacement.to,
          );
        }
          const hasForbiddenSurface = operation.forbiddenFragments.some((fragment) =>
            containsForbiddenSurface(answer, fragment),
          );
          if (hasForbiddenSurface && operation.fallbackAnswer) {
            answer = operation.fallbackAnswer;
            break;
          }
        if (hasForbiddenSurface) {
          for (const fragment of operation.forbiddenFragments) {
            answer = replaceForbiddenSurface(answer, fragment, "");
          }
          answer = answer
            .replace(/[ \t]+/gu, " ")
            .replace(/\s+([,.;:!?])/gu, "$1")
            .replace(/\(\s+/gu, "(")
            .replace(/\s+\)/gu, ")")
            .replace(/\n{3,}/gu, "\n\n")
            .trim();
          if (answer.length === 0 && operation.fallbackAnswer) {
            answer = operation.fallbackAnswer;
          }
        } else if (
          hadForbiddenSurface &&
          operation.fallbackAnswer &&
          !operation.replacementPairs?.length
        ) {
          answer = operation.fallbackAnswer;
        }
        break;
        }
      case "require_precondition_check":
        if (
          !mentionsPrecondition(answer, operation.precondition) ||
          !mentionsAllowedWhen(answer, operation.allowedWhen)
        ) {
          const allowedWhen =
            operation.allowedWhen && operation.allowedWhen.length > 0
              ? ` Only proceed when ${operation.allowedWhen.join(" or ")}.`
              : "";
          answer = `Check ${operation.precondition} first.${allowedWhen} ${applyFallbackBehavior(operation.fallbackBehavior)}`.trim();
        }
        break;
      case "require_warning":
        {
          const replacementTarget =
            operation.replacementTarget ??
            (operation.pathTemplate
              ? buildPathReplacementFromQuery(input.query, operation.pathTemplate)
              : undefined) ??
            (operation.urlTemplate
              ? buildUrlReplacementFromQuery(input.query, operation.urlTemplate)
              : undefined);
          const unsafePath =
            operation.pathTemplate
              ? extractPrimaryUnsafePathFromQuery(input.query, operation.pathTemplate)
              : undefined;
          const contradictorySafePathWarning =
            Boolean(operation.pathTemplate) &&
            looksLikeWarningAnswer(answer) &&
            Boolean(replacementTarget) &&
            answer.includes(replacementTarget!) &&
            Boolean(unsafePath) &&
            !answer.includes(unsafePath!);

          if (!satisfiesPreferredSafeSurface(answer, operation) || contradictorySafePathWarning) {
          answer = [
            operation.warningMessage,
            operation.preferredAlternatives?.length
              ? `Use ${operation.preferredAlternatives.join(" or ")} instead.`
              : undefined,
            replacementTarget
              ? `Safe replacement: ${replacementTarget}.`
              : undefined,
            operation.backupMention,
          ]
            .filter((entry): entry is string => Boolean(entry))
            .join(" ");
        }
        break;
        }
    }
  }

  if (input.plan.bulletOnly) {
    answer = toConciseBulletList(answer);
  } else if (input.plan.brevityOnly) {
    answer =
      (input.query ? computeConciseBrevityAnswerFromQuery(input.query) : undefined) ??
      extractBrevityOnlySurface(answer) ??
      answer;
  }

  return stripExplicitMemoryPhrasing(answer);
}

export function buildBehavioralSteeringLines(
  policies: readonly BehavioralPolicySelection[],
): string[] {
  const lines: string[] = [];

  for (const { feedback, policy } of policies) {
    if (policy.enactmentSurface !== "text_response") {
      continue;
    }

    if (policy.behavioralKind === "format_contract") {
      const prefixes = policy.applicability.exactFragments?.prefixes ?? [];
      const required = policy.applicability.exactFragments?.required ?? [];
      const suffixes = policy.applicability.exactFragments?.suffixes ?? [];
      if (prefixes.length > 0) {
        lines.push(`Start the response with "${prefixes[0]}".`);
      }
      for (const fragment of required) {
        lines.push(`Include the exact fragment "${fragment}".`);
      }
      if (suffixes.length > 0) {
        lines.push(`End the response with "${suffixes[0]}".`);
      }
      if (feedback.rule) {
        lines.push(`Follow this exact formatting rule: ${feedback.rule}`);
      }
      continue;
    }

    for (const replacement of policy.applicability.replacementPairs ?? []) {
      lines.push(
        `If the answer would contain "${replacement.from}", rewrite it to "${replacement.to}" instead of emitting the disallowed form.`,
      );
    }

    for (const fragment of policy.applicability.forbiddenFragments ?? []) {
      lines.push(
        `Do not emit the exact fragment "${fragment}" in the final answer unless directly quoting user input.`,
      );
    }

    for (const fragment of policy.applicability.preferredFragments ?? []) {
      lines.push(
        `Prefer a safe replacement fragment such as "${fragment}" when the current probe matches.`,
      );
    }

    if (policy.applicability.urlTemplate) {
      const { urlTemplate } = policy.applicability;
      lines.push(
        `When answering with a URL, keep the established origin "${urlTemplate.scheme}://${urlTemplate.host}" and place the requested page after the host as a path segment, for example "${urlTemplate.example}".`,
      );
      lines.push(
        "Do not rewrite the requested page into a subdomain when the learned URL pattern uses a path after the host.",
      );
    }

    if (policy.applicability.pathTemplate) {
      const { pathTemplate } = policy.applicability;
      lines.push(
        `When redirecting a file path, keep the established safe directory anchor "${pathTemplate.anchor}" and preserve the requested filename under that directory, for example "${pathTemplate.example}".`,
      );
      lines.push(
        "Do not invent a new top-level directory when the learned safe path already provides a concrete user-writable location.",
      );
    }

    if (policy.applicability.guard) {
      const { guard } = policy.applicability;
      const subject = guard.subject ? `"${guard.subject}"` : "the guarded behavior";
      lines.push(`Before using or implying ${subject}, ${guard.check}.`);
      if ((guard.allowedStates?.length ?? 0) > 0) {
        lines.push(
          `Only proceed when the required check resolves to ${guard.allowedStates!.join(" or ")}.`,
        );
      }
      if (guard.fallbackInstruction) {
        lines.push(guard.fallbackInstruction);
      }
    }

    if ((policy.applicability.preferredAlternatives?.length ?? 0) > 0) {
      lines.push(
        `Prefer ${policy.applicability.preferredAlternatives!
          .map((value) => `"${value}"`)
          .join(" or ")} as the safer replacement behavior when the trigger matches.`,
      );
    }

    if (policy.applicability.fallbackInstruction) {
      lines.push(policy.applicability.fallbackInstruction);
    }

    if (hasStructuredTextResponseSteering(policy)) {
      lines.push(
        "If a short compliant answer, redirect, or warning already satisfies the request, stop there instead of expanding into a longer response.",
      );
    }

    if (policy.behavioralKind === "transformation_rule") {
      if (feedback.rule && !hasStructuredTextResponseSteering(policy)) {
        lines.push(`Apply this rule only when it matches the current probe: ${feedback.rule}`);
      }
      continue;
    }

    if (policy.behavioralKind === "preference") {
      if (feedback.rule && !hasStructuredTextResponseSteering(policy)) {
        lines.push(`Prefer this behavior when it fits the current probe: ${feedback.rule}`);
      }
      continue;
    }

    if (policy.behavioralKind === "avoidance") {
      if (feedback.rule && !hasStructuredTextResponseSteering(policy)) {
        lines.push(`Avoid this behavior when the trigger matches: ${feedback.rule}`);
      }
      continue;
    }

    if (policy.behavioralKind === "exemplar_fact" && feedback.rule) {
      lines.push(
        `Treat this as example-bound guidance unless the probe clearly matches: ${feedback.rule}`,
      );
      continue;
    }
  }

  return uniqueStrings(lines);
}

function extractQuotedValues(value: string): string[] {
  return [...value.matchAll(/(?<![\p{L}\p{N}_/])(['"`])([^'"`]+)\1(?![\p{L}\p{N}_/])/gu)]
    .map((match) => match[2]?.trim())
    .filter((entry): entry is string => Boolean(entry));
}

function recoverDestinationSourceToolCall(input: {
  name: string;
  query: string;
}): BehavioralPolicyAction | undefined {
  const hostAction = analyzeBehavioralText(input.query)?.hostAction;
  const source = hostAction?.sources?.[0];
  let destination = hostAction?.destination;
  if (!source || !destination) {
    return undefined;
  }

  if (destination.endsWith("/")) {
    const filename = source.split("/").filter(Boolean).at(-1);
    if (filename) {
      destination = `${destination}${filename}`;
    }
  }

  return {
    args: [`'${destination}'`, `'${source}'`],
    kind: "tool_call",
    name: input.name,
    raw: `${input.name}('${destination}', '${source}')`,
  };
}

function inferCanonicalFirstAction(
  policy: BehavioralPolicy,
  query: string | undefined,
): BehavioralPolicyAction | undefined {
  const canonicalFirstAction = policy.applicability.canonicalFirstAction;
  if (canonicalFirstAction?.raw) {
    const filledTemplate = fillStructuredActionTemplate(
      canonicalFirstAction.raw,
      query,
    );
    if (filledTemplate) {
      const recovered = actionFromRawFirstLine(
        recoverPipedFilterAction(filledTemplate, query) ?? filledTemplate,
      );
      if (
        query &&
        recovered?.kind === "tool_call" &&
        (policy.applicability.argumentOrder ?? []).length >= 2 &&
        /(?:destination|target|archive)/iu.test(
          normalizeText(policy.applicability.argumentOrder?.[0]),
        ) &&
        normalizeText(policy.applicability.argumentOrder?.[1]).includes("source")
      ) {
        return recoverDestinationSourceToolCall({
          name: recovered.name,
          query,
        }) ?? recovered;
      }
      if (
        query &&
        recovered?.kind === "tool_call" &&
        recovered.args &&
        recovered.args.every((arg) => /^[a-z_][a-z0-9_]*$/iu.test(arg))
      ) {
        return recoverNamedToolCallAction(
          {
            ...policy,
            applicability: {
              ...policy.applicability,
              canonicalFirstAction: recovered,
            },
          },
          query,
        );
      }
      return recovered;
    }
    if (/<[^>]+>|\|(?:folder|path)\|/u.test(canonicalFirstAction.raw)) {
      return undefined;
    }
    return canonicalFirstAction;
  }

  if (!canonicalFirstAction?.name || !query) {
    return canonicalFirstAction;
  }

  const normalizedName = canonicalFirstAction.name.trim();
  if (
    canonicalFirstAction.kind === "tool_call" &&
    canonicalFirstAction.args &&
    canonicalFirstAction.args.every((arg) => /^[a-z_][a-z0-9_]*$/iu.test(arg))
  ) {
    return recoverNamedToolCallAction(policy, query);
  }

  const argumentOrder = policy.applicability.argumentOrder ?? [];
  if (
    argumentOrder.length < 2 ||
    !/(?:destination|target|archive)/iu.test(normalizeText(argumentOrder[0])) ||
    !normalizeText(argumentOrder[1]).includes("source")
  ) {
    return canonicalFirstAction;
  }

  return recoverDestinationSourceToolCall({
    name: normalizedName,
    query,
  }) ?? canonicalFirstAction;
}

export function buildBehavioralActionSteeringLines(
  policies: readonly BehavioralPolicySelection[],
  query?: string,
): string[] {
  const lines: string[] = [];

  for (const { feedback, policy } of policies) {
    if (policy.enactmentSurface !== "host_action") {
      continue;
    }

    if (feedback.rule) {
      lines.push(`Follow this first-action rule: ${feedback.rule}`);
    }

    const canonicalFirstAction = policy.applicability.canonicalFirstAction;
    const recoveredCanonicalAction = inferCanonicalFirstAction(policy, query);
    if (recoveredCanonicalAction?.raw) {
      lines.push(`The first line must be exactly: ${recoveredCanonicalAction.raw}`);
    } else if (canonicalFirstAction?.name) {
      lines.push(`Use "${canonicalFirstAction.name}" as the first executable action.`);
    }

    if ((policy.applicability.argumentOrder?.length ?? 0) > 0) {
      lines.push(
        `Preserve argument order exactly: ${policy.applicability.argumentOrder!.join(" before ")}.`,
      );
    }

    lines.push(
      "Do not replace the canonical action with generic shell prose, alternative utilities, or explanation-first text.",
    );
  }

  return uniqueStrings(lines);
}

export function recoverStructuredFirstActionAnswer(input: {
  answer: string;
  policies: readonly BehavioralPolicySelection[];
  query?: string;
}): string {
  const naturalLanguageAction = recoverNaturalLanguageStructuredAction(input.answer);
  const firstTypedPolicy = input.policies.find(
    ({ policy }) =>
      policy.enactmentSurface === "host_action" &&
      (policy.applicability.canonicalFirstAction || policy.applicability.argumentOrder),
  );
  if (!firstTypedPolicy) {
    return naturalLanguageAction ?? input.answer;
  }

  const recovered = inferCanonicalFirstAction(firstTypedPolicy.policy, input.query);
  return recovered?.raw ?? naturalLanguageAction ?? input.answer;
}

export function recoverCanonicalActionFromTemplate(input: {
  query?: string;
  template: string;
}): string | undefined {
  const canonicalFirstAction = actionFromRawFirstLine(input.template);
  if (!canonicalFirstAction) {
    return undefined;
  }

  const policy: BehavioralPolicy = {
    behavioralKind: "first_action",
    enactmentSurface: "host_action",
    applicability: {
      appliesTo: "general_response",
      canonicalFirstAction,
    },
    transferMode: "pattern_bounded",
  };

  return inferCanonicalFirstAction(policy, input.query)?.raw ?? canonicalFirstAction.raw;
}
