import type { ExportMemoryResult } from "../api/contracts";
import {
  normalizeFeedbackAppliesTo,
  type FeedbackMemory,
  type SessionJournal,
  type WorkingMemorySnapshot,
} from "../domain/records";
import type { EvidenceRecord } from "../evidence/contracts";
import {
  behavioralPolicyActionSatisfiesCanonical,
  deriveRuleBehavioralPolicy,
  type BehavioralPolicyAction,
  readBehavioralPolicyFromFeedbackMemory,
  selectBehavioralPolicies,
} from "../evolution/behavioralPolicy";
import type {
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import type {
  HostActionAssessmentResult,
  HostActionIntent,
  HostPlannedAction,
  HostRecommendedFirstStep,
} from "./contracts";

const HOST_PRE_ACTION_POLICY_PREFIX = "host_pre_action_policy";
const HIGH_RISK_COMMAND_MARKERS = [
  "deepanalyzer",
  "deploy",
  "drop",
  "git push",
  "migration",
  "prod",
  "production",
  "publish",
  "release",
  "rm -",
];
const HIGH_RISK_PATH_MARKERS = [
  "agents.md",
  "claude.md",
  "package.json",
  "playbooks/",
  "src/",
  "task-board/",
];
const EVIDENCE_PRIORITY: Record<EvidenceRecord["kind"], number> = {
  correction_context: 4,
  verification_result: 3,
  tool_result_excerpt: 2,
  document_excerpt: 2,
  conversation_excerpt: 1,
};

interface MatchedPattern {
  languageContext: ResolvedLanguageContext;
  linkedEvidenceIds: string[];
  pattern: FeedbackMemory;
  score: number;
}

interface MatchedEvidence {
  evidence: EvidenceRecord;
  languageContext: ResolvedLanguageContext;
  score: number;
}

interface MatchedTypedBehavioralPolicy {
  feedback: FeedbackMemory;
  languageContext: ResolvedLanguageContext;
  policy: NonNullable<ReturnType<typeof readBehavioralPolicyFromFeedbackMemory>>;
  score: number;
}

interface LanguageBoundText {
  languageContext: ResolvedLanguageContext;
  text: string;
}

type RuleClauseMatch = "allowed_replacement" | "matched" | "none";

const SHELL_COMMAND_SEPARATORS = new Set(["&&", ";", "|", "||"]);
const SHELL_COMMAND_WRAPPERS = new Set(["command", "env", "exec", "nohup"]);
const SHELL_VARIABLE_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    deduped.push(trimmed);
  }

  return deduped;
}

function normalizeForMatch(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function countTokenOverlap(
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
  left: string,
  right: string,
): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  return language.tokenOverlap(left, right, languageContext, {
    excludeStopwords: true,
  });
}

function resolveRecordLanguage(
  language: LanguageService,
  text: string,
  locale?: string,
): ResolvedLanguageContext {
  return language.resolveFromText({
    ...(locale ? { locale } : {}),
    text,
  });
}

function renderPolicyMessage(
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
  key: "guidance" | "instruction" | "none" | "verification",
  detail?: string,
): string {
  const label = language.render({ key }, languageContext);
  return detail ? `${label}: ${detail}` : label;
}

function describeAction(action: HostPlannedAction): string {
  switch (action.kind) {
    case "command":
      return [action.command, action.summary].filter(Boolean).join(" ");
    case "tool_call":
      return [
        action.toolName,
        action.raw,
        action.summary,
        action.payload ? JSON.stringify(action.payload) : undefined,
      ].filter(Boolean).join(" ");
    case "file_edit":
      return [action.operation, action.relativePath, action.summary].filter(Boolean).join(" ");
  }
}

export function buildHostPlannedActionSummary(action: HostPlannedAction): string {
  return describeAction(action);
}

function isActiveValidatedPattern(pattern: FeedbackMemory): boolean {
  return (
    pattern.kind === "validated_pattern" &&
    pattern.lifecycle === "active" &&
    !pattern.supersededBy
  );
}

function appliesToCodingAgent(pattern: FeedbackMemory): boolean {
  const appliesTo = normalizeFeedbackAppliesTo(pattern.appliesTo);
  return appliesTo === "coding_agent" || appliesTo === "general_response";
}

function collectLinkedEvidenceIds(
  exported: ExportMemoryResult,
  memoryId: string,
): string[] {
  const linkedFromEvidence = exported.durable.evidence
    .filter((record) => record.linkedMemoryIds.includes(memoryId))
    .map((record) => record.id);
  const linkedFromExperiences = exported.durable.experiences
    .filter((record) => record.linkedMemoryIds.includes(memoryId))
    .flatMap((record) => record.linkedEvidenceIds);
  const linkedFromPromotions = exported.durable.promotions
    .filter((record) => record.linkedMemoryIds.includes(memoryId))
    .flatMap((record) => record.linkedEvidenceIds);

  return uniqueStrings([
    ...patternEvidenceIds(exported, memoryId),
    ...linkedFromEvidence,
    ...linkedFromExperiences,
    ...linkedFromPromotions,
  ]);
}

function patternEvidenceIds(exported: ExportMemoryResult, memoryId: string): string[] {
  const pattern = exported.durable.feedback.find((record) => record.id === memoryId);
  return uniqueStrings(pattern?.evidence ?? []);
}

function splitRuleClauses(
  rule: string,
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
): string[] {
  return language
    .splitClauses(rule, languageContext)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function matchActionRuleClauses(input: {
  action: HostPlannedAction;
  actionText: string;
  language: LanguageService;
  languageContext: ResolvedLanguageContext;
  rule: string;
}): RuleClauseMatch {
  const executableNames = extractExecutableTokens(input.action).map((token) =>
    input.language.normalizeForEquality(
      token.split(/[\\/]/u).at(-1) ?? token,
      input.languageContext,
    )
  );
  let hasNegativeClause = false;
  let matchedNegativeClause = false;
  let matchedOtherClause = false;

  for (const clause of splitRuleClauses(
    input.rule,
    input.language,
    input.languageContext,
  )) {
    const negative = hasNegativeSignal(
      {
        languageContext: input.languageContext,
        text: clause,
      },
      input.language,
    );
    hasNegativeClause ||= negative;
    const searchTerms = input.language.buildSearchTerms(
      clause,
      input.languageContext,
    );
    const executableMatch = executableNames.some((name) =>
      searchTerms.includes(name)
    );
    const clauseMatch =
      executableMatch ||
      countTokenOverlap(
        input.language,
        input.languageContext,
        clause,
        input.actionText,
      ) > 0;
    if (!clauseMatch) {
      continue;
    }

    if (negative) {
      matchedNegativeClause = true;
    } else {
      matchedOtherClause = true;
    }
  }

  if (matchedNegativeClause) {
    return "matched";
  }
  if (hasNegativeClause && matchedOtherClause) {
    return "allowed_replacement";
  }
  return matchedOtherClause ? "matched" : "none";
}

function matchPatterns(
  exported: ExportMemoryResult,
  intent: HostActionIntent,
  actionText: string,
  language: LanguageService,
): MatchedPattern[] {
  return exported.durable.feedback
    .filter((record) => isActiveValidatedPattern(record) && appliesToCodingAgent(record))
    .map((pattern) => {
      const searchableRule = [pattern.rule, pattern.why].filter(Boolean).join(" ");
      const languageContext = resolveRecordLanguage(
        language,
        searchableRule,
        pattern.source.locale,
      );
      const overlap = countTokenOverlap(
        language,
        languageContext,
        searchableRule,
        actionText,
      );
      const normalizedRule = language.normalizeForEquality(
        searchableRule,
        languageContext,
      );
      const actionSummary = language.normalizeForEquality(
        buildHostPlannedActionSummary(intent.action),
        languageContext,
      );
      const normalizedActionText = language.normalizeForEquality(
        actionText,
        languageContext,
      );
      const clauseMatch = matchActionRuleClauses({
        action: intent.action,
        actionText,
        language,
        languageContext,
        rule: searchableRule,
      });
      const directMarkerMatch = clauseMatch !== "allowed_replacement" && (
        clauseMatch === "matched"
        || overlap > 0
        || normalizedRule.includes(actionSummary)
        || normalizedRule.includes(normalizedActionText)
      );

      if (!directMarkerMatch) {
        return null;
      }

      return {
        languageContext,
        pattern,
        linkedEvidenceIds: collectLinkedEvidenceIds(exported, pattern.id),
        score: overlap + (pattern.why ? 1 : 0) + Math.round(pattern.confidence),
      } satisfies MatchedPattern;
    })
    .filter((record): record is MatchedPattern => Boolean(record))
    .sort((left, right) => right.score - left.score);
}

function matchEvidence(
  exported: ExportMemoryResult,
  actionText: string,
  language: LanguageService,
): MatchedEvidence[] {
  return exported.durable.evidence
    .map((evidence) => {
      const languageContext = resolveRecordLanguage(
        language,
        evidence.excerpt,
        evidence.source.locale,
      );
      const overlap = countTokenOverlap(
        language,
        languageContext,
        evidence.excerpt,
        actionText,
      );
      if (overlap === 0) {
        return null;
      }

      return {
        evidence,
        languageContext,
        score: overlap + EVIDENCE_PRIORITY[evidence.kind],
      } satisfies MatchedEvidence;
    })
    .filter((record): record is MatchedEvidence => Boolean(record))
    .sort((left, right) => right.score - left.score);
}

function isHighRiskAction(action: HostPlannedAction): boolean {
  if (action.kind === "file_edit") {
    if (action.operation === "delete") {
      return true;
    }

    const normalizedPath = normalizeForMatch(action.relativePath);
    return HIGH_RISK_PATH_MARKERS.some((marker) => normalizedPath.includes(marker));
  }

  const normalized = normalizeForMatch(describeAction(action));
  return HIGH_RISK_COMMAND_MARKERS.some((marker) => normalized.includes(marker));
}

function hasNegativeSignal(
  value: LanguageBoundText,
  language: LanguageService,
): boolean {
  const analysis = language.analyzeContent(
    value.text,
    value.languageContext,
  );
  return analysis.feedbackKind === "dont" || analysis.factPolarity === "negative";
}

function deriveStructuredQuickCheckPrecondition(
  value: LanguageBoundText,
  language: LanguageService,
): string | undefined {
  const policy = deriveRuleBehavioralPolicy({
    appliesTo: "coding_agent",
    kind: "do",
    language,
    languageContext: value.languageContext,
    rule: value.text,
  });
  const canonicalFirstAction = policy.enactmentSurface === "host_action"
    ? policy.applicability.canonicalFirstAction
    : undefined;
  return normalizeForMatch(canonicalFirstAction?.name) === "quickcheck"
    ? value.text
    : undefined;
}

function extractPreconditions(
  values: readonly LanguageBoundText[],
  language: LanguageService,
): string[] {
  const preconditions: string[] = [];

  for (const value of values) {
    const sentence = language
      .splitSentences(value.text, value.languageContext)
      .find((segment) =>
        language.analyzeQuery(segment, value.languageContext).before
      );
    if (sentence) {
      preconditions.push(sentence);
      continue;
    }

    const structuredQuickCheck = deriveStructuredQuickCheckPrecondition(
      value,
      language,
    );
    if (structuredQuickCheck) {
      preconditions.push(structuredQuickCheck);
    }
  }

  return uniqueStrings(preconditions);
}

function parseShellCommandTokens(value: string): string[] {
  return [...value.matchAll(/'([^']*)'|"([^"]*)"|(&&|\|\||[;|])|([^\s;&|]+)/gu)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? "")
    .filter((token) => token.length > 0);
}

function resolveSegmentExecutable(tokens: readonly string[]): string | undefined {
  let index = 0;
  while (SHELL_VARIABLE_ASSIGNMENT.test(tokens[index] ?? "")) {
    index += 1;
  }

  while (index < tokens.length) {
    const token = tokens[index]!;
    const name = normalizeForMatch(token.split(/[\\/]/u).at(-1));
    if (!SHELL_COMMAND_WRAPPERS.has(name)) {
      return token;
    }

    index += 1;
    while ((tokens[index] ?? "").startsWith("-")) {
      index += 1;
    }
    while (SHELL_VARIABLE_ASSIGNMENT.test(tokens[index] ?? "")) {
      index += 1;
    }

    if (index >= tokens.length) {
      return token;
    }
  }

  return undefined;
}

function extractExecutableTokens(action: HostPlannedAction): string[] {
  const rawCommand = action.kind === "command"
    ? action.command
    : action.kind === "tool_call"
      ? action.raw
      : undefined;
  const trimmed = rawCommand?.trim();

  if (!trimmed) {
    return [];
  }

  const executables: string[] = [];
  let segment: string[] = [];
  for (const token of parseShellCommandTokens(trimmed)) {
    if (SHELL_COMMAND_SEPARATORS.has(token)) {
      const executable = resolveSegmentExecutable(segment);
      if (executable) {
        executables.push(executable);
      }
      segment = [];
      continue;
    }
    segment.push(token);
  }

  const executable = resolveSegmentExecutable(segment);
  if (executable) {
    executables.push(executable);
  }
  return uniqueStrings(executables);
}

function extractExecutableToken(action: HostPlannedAction): string | undefined {
  return extractExecutableTokens(action)[0];
}

function resolveSiblingExecutablePath(
  executableToken: string | undefined,
  siblingName: string,
): string | undefined {
  const normalized = executableToken?.trim();
  if (!normalized || !normalized.includes("/")) {
    return undefined;
  }

  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex < 0) {
    return undefined;
  }

  return `${normalized.slice(0, lastSlashIndex + 1)}${siblingName}`;
}

function buildRecommendedFirstStep(
  preconditions: readonly string[],
  action: HostPlannedAction,
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
): HostRecommendedFirstStep | undefined {
  const first = preconditions[0];
  if (!first) {
    return undefined;
  }

  const normalized = normalizeForMatch(first);
  if (normalized.includes("quickcheck")) {
    const quickCheckPath = resolveSiblingExecutablePath(
      extractExecutableToken(action),
      "QuickCheck",
    );
    if (quickCheckPath) {
      return {
        kind: "tool_call",
        toolName: "QuickCheck",
        raw: quickCheckPath,
        summary: renderPolicyMessage(
          language,
          languageContext,
          "instruction",
          first,
        ),
      };
    }

    return {
      kind: "warning",
      message: first,
    };
  }

  return {
    kind: "warning",
    message: first,
  };
}

function parseCommandTokens(value: string): string[] {
  return [...value.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/gu)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((token) => token.length > 0);
}

function toBehavioralPolicyAction(
  action: HostPlannedAction,
): BehavioralPolicyAction {
  if (action.kind === "tool_call") {
    const raw = action.raw?.trim();
    return {
      ...(raw ? { args: parseCommandTokens(raw).slice(1), raw } : {}),
      kind: "tool_call",
      name: action.toolName,
    };
  }

  if (action.kind === "command") {
    const raw = action.command.trim();
    const tokens = parseCommandTokens(raw);
    return {
      args: tokens.slice(1),
      kind: "command",
      name: tokens[0] ?? raw,
      raw,
    };
  }

  return {
    kind: "warning",
    name: "file_edit",
    raw: `${action.operation} ${action.relativePath}`,
  };
}

function behavioralPolicyActionToRecommendedStep(
  action: BehavioralPolicyAction,
  detail: string,
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
): HostRecommendedFirstStep {
  if (action.kind === "warning") {
    return {
      kind: "warning",
      message: action.raw ?? action.name,
    };
  }

  if (action.kind === "tool_call") {
    return {
      kind: "tool_call",
      toolName: action.name,
      ...(action.raw ? { raw: action.raw } : {}),
      summary: renderPolicyMessage(
        language,
        languageContext,
        "instruction",
        detail,
      ),
    };
  }

  return {
    command:
      action.raw ??
      [action.name, ...(action.args ?? [])].filter(Boolean).join(" "),
    kind: "command",
    summary: renderPolicyMessage(
      language,
      languageContext,
      "instruction",
      detail,
    ),
  };
}

function matchTypedBehavioralPolicies(
  exported: ExportMemoryResult,
  intent: HostActionIntent,
  actionText: string,
  language: LanguageService,
): MatchedTypedBehavioralPolicy[] {
  const selections = selectBehavioralPolicies({
    appliesTo: "coding_agent",
    feedback: exported.durable.feedback,
    query: actionText,
    surface: "host_action",
  });
  const currentAction = toBehavioralPolicyAction(intent.action);

  return selections
    .map((selection) => {
      const searchableRule = [selection.feedback.rule, selection.feedback.why]
        .filter(Boolean)
        .join(" ");
      const languageContext = resolveRecordLanguage(
        language,
        searchableRule,
        selection.feedback.source.locale,
      );
      const overlap = countTokenOverlap(
        language,
        languageContext,
        searchableRule,
        actionText,
      );
      const canonicalAction = selection.policy.applicability.canonicalFirstAction;
      const canonicalNameMatch =
        canonicalAction &&
        normalizeForMatch(canonicalAction.name) === normalizeForMatch(currentAction.name);
      if (
        selection.matchedQueryTokens.length === 0 &&
        overlap === 0 &&
        !canonicalNameMatch
      ) {
        return null;
      }
      return {
        feedback: selection.feedback,
        languageContext,
        policy: selection.policy,
        score: selection.score + overlap,
      } satisfies MatchedTypedBehavioralPolicy;
    })
    .filter((record): record is MatchedTypedBehavioralPolicy => Boolean(record))
    .sort((left, right) => right.score - left.score);
}

function resolveRuntimeGuidance(input: {
  action: HostPlannedAction;
  journal: SessionJournal | null | undefined;
  language: LanguageService;
  workingMemory: WorkingMemorySnapshot | null | undefined;
}): string[] {
  const guidance: string[] = [];
  const highRisk = isHighRiskAction(input.action);

  if (input.workingMemory?.temporaryDecisions?.length) {
    guidance.push(...input.workingMemory.temporaryDecisions);
  }

  if (highRisk && input.workingMemory?.openLoops?.length) {
    const openLoop = input.workingMemory.openLoops[0]!;
    const languageContext = resolveRecordLanguage(input.language, openLoop);
    guidance.push(
      renderPolicyMessage(
        input.language,
        languageContext,
        "guidance",
        openLoop,
      ),
    );
  }

  if (highRisk && input.journal?.workflow?.length) {
    const workflow = input.journal.workflow[0]!;
    const languageContext = resolveRecordLanguage(input.language, workflow);
    guidance.push(
      `${input.language.render({ key: "workflow" }, languageContext)}: ${workflow}`,
    );
  }

  if (input.journal?.errorsAndCorrections?.length) {
    guidance.push(input.journal.errorsAndCorrections[0]!);
  }

  return uniqueStrings(guidance);
}

function buildPolicyApplied(input: {
  decision: HostActionAssessmentResult["decision"];
  highRisk: boolean;
  intent: HostActionIntent;
  matchedEvidenceIds: readonly string[];
  matchedMemoryIds: readonly string[];
}): string[] {
  return uniqueStrings([
    HOST_PRE_ACTION_POLICY_PREFIX,
    `${HOST_PRE_ACTION_POLICY_PREFIX}.decision=${input.decision}`,
    `${HOST_PRE_ACTION_POLICY_PREFIX}.action_kind=${input.intent.action.kind}`,
    `${HOST_PRE_ACTION_POLICY_PREFIX}.host_kind=${input.intent.hostKind}`,
    input.highRisk ? `${HOST_PRE_ACTION_POLICY_PREFIX}.high_risk` : undefined,
    input.matchedMemoryIds.length > 0
      ? `${HOST_PRE_ACTION_POLICY_PREFIX}.matched_memory=${input.matchedMemoryIds.length}`
      : undefined,
    input.matchedEvidenceIds.length > 0
      ? `${HOST_PRE_ACTION_POLICY_PREFIX}.matched_evidence=${input.matchedEvidenceIds.length}`
      : undefined,
  ]);
}

function shouldBlockIrrecoverably(action: HostPlannedAction): boolean {
  if (action.kind === "file_edit") {
    return action.operation === "delete";
  }

  if (action.kind === "command") {
    const normalized = normalizeForMatch(action.command);
    return normalized.includes("rm -") || normalized.includes("git reset --hard");
  }

  return false;
}

export function assessHostAction(input: {
  exported: ExportMemoryResult;
  intent: HostActionIntent;
  language: LanguageService;
}): HostActionAssessmentResult {
  const actionText = describeAction(input.intent.action);
  const typedPolicies = matchTypedBehavioralPolicies(
    input.exported,
    input.intent,
    actionText,
    input.language,
  );
  const matchedPatterns = matchPatterns(
    input.exported,
    input.intent,
    actionText,
    input.language,
  );
  const matchedEvidence = matchEvidence(
    input.exported,
    actionText,
    input.language,
  );
  const matchedMemoryIds = uniqueStrings(
    [
      ...typedPolicies.map((record) => record.feedback.id),
      ...matchedPatterns.map((record) => record.pattern.id),
    ],
  );
  const matchedEvidenceIds = uniqueStrings([
    ...typedPolicies.flatMap((record) => record.feedback.evidence ?? []),
    ...matchedPatterns.flatMap((record) => record.linkedEvidenceIds),
    ...matchedEvidence.map((record) => record.evidence.id),
  ]);
  const patternTexts: LanguageBoundText[] = matchedPatterns.flatMap((record) =>
    [record.pattern.rule, record.pattern.why].filter(
      (text): text is string => Boolean(text),
    ).map((text) => ({
      languageContext: record.languageContext,
      text,
    }))
  );
  const evidenceTexts: LanguageBoundText[] = matchedEvidence.map((record) => ({
    languageContext: record.languageContext,
    text: record.evidence.excerpt,
  }));
  const policyTexts = [...patternTexts, ...evidenceTexts];
  const requiredPreconditions = extractPreconditions(policyTexts, input.language);
  const runtimeGuidance = resolveRuntimeGuidance({
    action: input.intent.action,
    journal: input.exported.runtime?.journal,
    language: input.language,
    workingMemory: input.exported.runtime?.workingMemory,
  });
  const guidance = uniqueStrings([
    ...patternTexts.map(({ text }) => text),
    ...runtimeGuidance,
  ]).slice(0, 4);
  const highRisk = isHighRiskAction(input.intent.action);
  const memoryBacked = matchedMemoryIds.length > 0 || matchedEvidenceIds.length > 0;
  const negativeSignal = policyTexts.some((text) =>
    hasNegativeSignal(text, input.language)
  );
  const firstTypedPolicy = typedPolicies[0];
  const primaryPolicyText: LanguageBoundText | undefined = firstTypedPolicy
    ? {
        languageContext: firstTypedPolicy.languageContext,
        text: firstTypedPolicy.feedback.rule,
      }
    : policyTexts[0];
  const actionLanguageContext = resolveRecordLanguage(input.language, actionText);
  const outputLanguageContext = primaryPolicyText?.languageContext ??
    actionLanguageContext;

  let decision: HostActionAssessmentResult["decision"] = "allow";
  let reason = renderPolicyMessage(
    input.language,
    actionLanguageContext,
    "guidance",
    renderPolicyMessage(input.language, actionLanguageContext, "none"),
  );
  let recommendedFirstStep: HostRecommendedFirstStep | undefined;
  const currentAction = toBehavioralPolicyAction(input.intent.action);

  const canonicalFirstAction = firstTypedPolicy?.policy.applicability.canonicalFirstAction;
  if (firstTypedPolicy && canonicalFirstAction) {
    guidance.unshift(firstTypedPolicy.feedback.rule);
    if (!behavioralPolicyActionSatisfiesCanonical(currentAction, canonicalFirstAction)) {
      decision = "review_required";
      reason = renderPolicyMessage(
        input.language,
        firstTypedPolicy.languageContext,
        "instruction",
        firstTypedPolicy.feedback.rule,
      );
      recommendedFirstStep = behavioralPolicyActionToRecommendedStep(
        canonicalFirstAction,
        firstTypedPolicy.feedback.rule,
        input.language,
        firstTypedPolicy.languageContext,
      );
    } else if (guidance.length > 0) {
      decision = "allow_with_guidance";
      reason = renderPolicyMessage(
        input.language,
        firstTypedPolicy.languageContext,
        "verification",
        firstTypedPolicy.feedback.rule,
      );
    }
  }

  if (
    decision === "allow" &&
    memoryBacked &&
    highRisk &&
    (negativeSignal || requiredPreconditions.length > 0)
  ) {
    recommendedFirstStep = buildRecommendedFirstStep(
      requiredPreconditions,
      input.intent.action,
      input.language,
      outputLanguageContext,
    );
    if (shouldBlockIrrecoverably(input.intent.action) && !recommendedFirstStep) {
      decision = "blocked";
      reason = renderPolicyMessage(
        input.language,
        outputLanguageContext,
        "instruction",
        primaryPolicyText?.text,
      );
    } else {
      decision = "review_required";
      reason = renderPolicyMessage(
        input.language,
        outputLanguageContext,
        "instruction",
        primaryPolicyText?.text,
      );
      recommendedFirstStep ??= {
        kind: "warning",
        message: primaryPolicyText?.text ?? reason,
      };
    }
  } else if (decision === "allow" && guidance.length > 0) {
    decision = "allow_with_guidance";
    const guidanceLanguageContext = resolveRecordLanguage(
      input.language,
      guidance[0]!,
    );
    reason = renderPolicyMessage(
      input.language,
      guidanceLanguageContext,
      "guidance",
      guidance[0],
    );
  }

  const policyApplied = buildPolicyApplied({
    decision,
    highRisk,
    intent: input.intent,
    matchedEvidenceIds,
    matchedMemoryIds,
  });

  return {
    actionId: input.intent.actionId,
    auditRecorded: false,
    decision,
    guidance,
    matchedEvidenceIds,
    matchedMemoryIds,
    policyApplied,
    reason,
    ...(recommendedFirstStep ? { recommendedFirstStep } : {}),
    requiredPreconditions,
  };
}
