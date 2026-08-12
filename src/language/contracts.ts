import type { MemoryCandidate } from "../domain/memoryCandidate";
import type { FeedbackKind } from "../domain/records";
import type { TemporalExpression } from "../domain/temporal";

export type { TemporalExpression } from "../domain/temporal";

export type LocaleResolutionSource = "explicit" | "detected" | "default";

export type LanguageDetectionStrength =
  | "distinctive"
  | "compatible"
  | "none";

export type LanguageDetectionMode = "auto" | "default_only";

export interface LanguageDetectionInput {
  texts: string[];
}

export interface LanguageCandidateExtractionInput {
  messages: Array<{
    analysis?: LanguageContentAnalysis;
    role: string;
    content: string;
    observedAt?: string;
    sourceMessageIndex?: number;
    timezone?: string;
  }>;
  locale: string;
  nextId: () => string;
}

export interface LanguageQueryAnalysis {
  actionDriving: boolean;
  after: boolean;
  aggregateCount: boolean;
  answerComposition: boolean;
  assistantEvidenceRecall: boolean;
  before: boolean;
  blocker: boolean;
  change: boolean;
  continuation: boolean;
  current: boolean;
  directFactualLookup: boolean;
  eventOccurrenceQuery?: boolean;
  eventOccurrenceQueryMode?: "broad" | "predicate";
  exhaustiveList: boolean;
  factConfirmation: boolean;
  focus: boolean;
  guidanceSeeking: boolean;
  history: boolean;
  openLoop: boolean;
  procedural: boolean;
  projectState: boolean;
  recommendationStyle: boolean;
  relation: boolean;
  referenceSeeking: boolean;
  role: boolean;
  temporalInterval?: boolean;
  temporalOperands?: readonly string[];
  userGroundedEventOrder: boolean;
}

export interface LanguageSourceOfTruthDirective {
  currentPointer: string;
  supersededPointer?: string;
}

export interface LanguageContentAnalysis {
  assistantAcknowledgement: boolean;
  assistantContinuity: boolean;
  blockerFact: boolean;
  correctionCue: boolean;
  durableCue: boolean;
  factPolarity: "positive" | "negative" | "unknown";
  feedbackKind: FeedbackKind;
  focusFact: boolean;
  openLoopFact: boolean;
  personalEvidence: boolean;
  preferenceEvidence: boolean;
  projectStateFact: boolean;
  roleFact: boolean;
  sensitiveCredential: boolean;
  sourceOfTruthDirective?: LanguageSourceOfTruthDirective;
  unresolved: boolean;
}

export interface LanguageBehavioralRuleAnalysis {
  analogyText?: string;
  argumentOrder?: string[];
  backupRequested?: boolean;
  commandName?: string;
  conciseComputation?:
    | { base: number; kind: "percentage"; percentage: number }
    | { kind: "circle_circumference"; radius: number }
    | { kind: "iso_datetime_command" };
  comparison?: {
    field?: string;
    operator?: "<" | "<=" | "=" | ">" | ">=";
    value?: string;
  };
  directoryRestriction?: {
    forbiddenRoot?: string;
    safeTemplate?: string;
    userHomeRequired?: boolean;
  };
  distrustRouting?: {
    preferredAlternative?: string;
    target: string;
  };
  exactAction?: string;
  filetypeReplacement?: {
    forbidden: string;
    preferred: string;
  };
  firstActionName?: string;
  forbiddenFragments?: string[];
  formatRule: boolean;
  formatPrefix?: string;
  formatSurface?: {
    prefixes: string[];
    suffixes: string[];
  };
  formatSuffix?: string;
  generalRule: boolean;
  guard?: {
    allowedStates: string[];
    check: string;
    subject?: string;
  };
  hostAction?: {
    compression?: string;
    destination?: string;
    flags?: string[];
    mode?: string;
    owner?: string;
    permissions?: string;
    sources?: string[];
    tag?: string;
    verb?: string;
  };
  negativeRule: boolean;
  namedTarget?: string;
  pathBase?: string;
  preferredAlternatives?: string[];
  preferredFragments?: string[];
  protocolReplacement?: {
    forbiddenUrl: string;
    preferredUrl: string;
  };
  protocolRewrite?: {
    template?: string;
  };
  requiredFragments?: string[];
  responseStyle?: "brief" | "bullets";
  semanticCues?: Array<
    | "analogy"
    | "api"
    | "argument_order"
    | "brevity"
    | "command"
    | "failure"
    | "filetype"
    | "format"
    | "inhibition_replacement"
    | "operation"
    | "path"
    | "permission_failure"
    | "precondition"
    | "safe_fallback"
    | "style"
    | "symbolic"
    | "timeout"
    | "unsafe"
    | "url"
    | "voice"
  >;
  structuredTerms?: string[];
  triggerPhrases?: string[];
  warningSignal?: boolean;
}

export type LanguageTemporalExpression = TemporalExpression;

export interface LanguageEntityMention {
  kind?: "identifier" | "location" | "organization" | "person" | "term";
  normalized: string;
  surface: string;
}

export interface LanguageEntityCandidateInput {
  aliases: readonly string[];
  canonicalKey: string;
  documentTexts: readonly string[];
}

export type LanguageRenderKey =
  | "active_context"
  | "additional_project_state"
  | "archive"
  | "archive_recap"
  | "artifact_spills"
  | "behavioral_controls_available"
  | "behavioral_exact_surface"
  | "behavioral_example"
  | "behavioral_observed_outcome"
  | "behavioral_raw_response_control"
  | "behavioral_relevant_prior_examples"
  | "behavioral_safe_corrected_move"
  | "behavioral_situation"
  | "behavioral_successful_move"
  | "canonical_pattern"
  | "correction"
  | "current_goal"
  | "current_projects"
  | "current_state"
  | "constraints"
  | "deferred_follow_up"
  | "developer_memory_notes"
  | "durable_memory"
  | "earlier_messages_compacted"
  | "episode"
  | "episode_assistant_follow_through_captured"
  | "episode_assistant_follow_through_on"
  | "episode_assistant_substantive_continuity_captured"
  | "episode_conversation_covered"
  | "episode_item"
  | "evidence"
  | "evidence_entry"
  | "evidence_note"
  | "experiences"
  | "excerpt"
  | "fact"
  | "fact_item"
  | "feedback"
  | "file_evidence"
  | "file_or_function"
  | "goals"
  | "guidance"
  | "immediate_next_steps"
  | "installed_host_claude_memory_protocol"
  | "installed_host_context_tool_protocol"
  | "installed_host_injected_context_protocol"
  | "installed_host_intro"
  | "installed_host_projection_protocol"
  | "installed_host_protocol_heading"
  | "installed_host_record_tools_protocol"
  | "installed_host_remember_protocol"
  | "instruction"
  | "journal"
  | "key_decisions"
  | "key_files"
  | "language_label"
  | "learning_proposals"
  | "lineage"
  | "location"
  | "memory_index"
  | "metadata"
  | "name"
  | "none"
  | "organization"
  | "claim"
  | "actor"
  | "open_loops"
  | "omitted_sections"
  | "preference"
  | "playbook_title"
  | "procedural_memory"
  | "profile"
  | "progressive_detail_instruction"
  | "progressive_detail_instruction_compact"
  | "progressive_recall"
  | "prompt_snippet_title"
  | "promotions"
  | "procedure"
  | "recent_decisions"
  | "recent_worklog"
  | "reference"
  | "reference_item"
  | "referenced_artifacts"
  | "relation_label"
  | "role_label"
  | "scope"
  | "session_archive_item"
  | "session_ended_without_summary"
  | "session_handoff"
  | "session_memory"
  | "session_resume_query"
  | "session_start_query"
  | "skill_snippet_title"
  | "tool_result"
  | "temporal_status"
  | "summary"
  | "detail_tokens"
  | "omitted_records"
  | "record_kind"
  | "record_ref"
  | "temporary_decision"
  | "timezone"
  | "verification"
  | "user_memory_context"
  | "user_memory"
  | "undated"
  | "use_when"
  | "default_label"
  | "workflow"
  | "working_memory"
  | "why"
  | "workspace_query_anchor";

export interface LanguageRenderInput {
  key: LanguageRenderKey;
  values?: Record<string, number | string>;
}

export interface LanguagePack {
  readonly analyzerVersion: string;
  readonly apiVersion: 1;
  readonly compatibilityGroup: string;
  readonly defaultLocale: string;
  readonly id: string;
  readonly locales: readonly string[];
  detect(input: LanguageDetectionInput): LanguageDetectionStrength;
  normalizeForEquality(text: string): string;
  tokenizeForScoring(
    text: string,
    mode: "bm25" | "overlap",
    options?: { excludeStopwords?: boolean },
  ): string[];
  buildSearchTerms(text: string): string[];
  splitClauses(text: string): string[];
  splitSentences(text: string): string[];
  decomposeQuery(text: string): string[];
  analyzeBehavioralRule(text: string): LanguageBehavioralRuleAnalysis;
  analyzeQuery(text: string): LanguageQueryAnalysis;
  analyzeContent(text: string): LanguageContentAnalysis;
  parseTemporalExpressions(text: string): LanguageTemporalExpression[];
  matchesEventPredicate?(query: string, candidate: string): boolean;
  extractEntityMentions(text: string): LanguageEntityMention[];
  matchesEntityAlias(query: string, alias: string): boolean;
  acceptsEntityCandidate(input: LanguageEntityCandidateInput): boolean;
  extractCandidates(input: LanguageCandidateExtractionInput): MemoryCandidate[];
  render(input: LanguageRenderInput): string;
}

export interface LocaleDetectorInput {
  explicitLocale?: string;
  texts: string[];
  defaultLocale?: string;
}

export type LocaleDetector = (
  input: LocaleDetectorInput,
) => string | undefined;

export interface LanguageConfig {
  defaultLocale?: string;
  detection?: LanguageDetectionMode;
  detector?: LocaleDetector;
  detectorVersion?: string;
  packs?: readonly LanguagePack[];
}

export interface LanguageAnalyzerManifestPack {
  readonly analyzerVersion: string;
  readonly apiVersion: 1;
  readonly compatibilityGroup: string;
  readonly defaultLocale: string;
  readonly id: string;
  readonly locales: readonly string[];
}

export interface LanguageAnalyzerManifest {
  readonly defaultLocale: string;
  readonly detection: LanguageDetectionMode;
  readonly detectorVersion?: string;
  readonly packs: readonly LanguageAnalyzerManifestPack[];
  readonly persistable: boolean;
  readonly resolutionOrder: readonly string[];
  readonly resolverVersion: string;
  readonly schemaVersion: 1;
}

export interface ResolvedLanguageContext {
  analysisMode: "rules-only";
  compatibilityGroup: string;
  languagePackId: string;
  languagePackVersion: string;
  locale: string;
  localeSource: LocaleResolutionSource;
}

export interface LanguageService {
  getAnalyzerManifest(): LanguageAnalyzerManifest;
  resolveFromMessages(input: {
    locale?: string;
    messages: Array<{ role: string; content: string }>;
  }): ResolvedLanguageContext;
  resolveFromText(input: {
    locale?: string;
    text: string;
  }): ResolvedLanguageContext;
  analyzerVersion(
    context: ResolvedLanguageContext | string,
  ): string;
  normalizeForEquality(
    text: string,
    context: ResolvedLanguageContext | string,
  ): string;
  tokenize(
    text: string,
    context: ResolvedLanguageContext | string,
    options?: { excludeStopwords?: boolean },
  ): string[];
  buildSearchTerms(
    text: string,
    context: ResolvedLanguageContext | string,
  ): string[];
  splitClauses(
    text: string,
    context: ResolvedLanguageContext | string,
  ): string[];
  splitSentences(
    text: string,
    context: ResolvedLanguageContext | string,
  ): string[];
  decomposeQuery(
    text: string,
    context: ResolvedLanguageContext | string,
  ): string[];
  analyzeBehavioralRule(
    text: string,
    context: ResolvedLanguageContext | string,
  ): LanguageBehavioralRuleAnalysis;
  analyzeQuery(
    text: string,
    context: ResolvedLanguageContext | string,
  ): LanguageQueryAnalysis;
  analyzeContent(
    text: string,
    context: ResolvedLanguageContext | string,
  ): LanguageContentAnalysis;
  parseTemporalExpressions(
    text: string,
    context: ResolvedLanguageContext | string,
  ): LanguageTemporalExpression[];
  matchesEventPredicate(
    query: string,
    candidate: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  extractEntityMentions(
    text: string,
    context: ResolvedLanguageContext | string,
  ): LanguageEntityMention[];
  matchesEntityAlias(
    query: string,
    alias: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  acceptsEntityCandidate(
    input: LanguageEntityCandidateInput,
    context: ResolvedLanguageContext | string,
  ): boolean;
  extractCandidates(
    input: LanguageCandidateExtractionInput,
    context: ResolvedLanguageContext | string,
  ): MemoryCandidate[];
  render(
    input: LanguageRenderInput,
    context: ResolvedLanguageContext | string,
  ): string;
  tokenOverlap(
    left: string,
    right: string,
    context: ResolvedLanguageContext | string,
    options?: { excludeStopwords?: boolean },
  ): number;
  localesCompatible(left: string, right: string): boolean;
  isAnswerCompositionQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isReferenceSeekingQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isRoleQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isFocusQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isOpenLoopQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isBlockerQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isProjectStateQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isFactConfirmationQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isActionDrivingQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isAggregateCountQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isAssistantEvidenceRecallQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isContinuationQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isDirectFactualLookupQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isGuidanceSeekingQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isRecommendationStyleQuery(
    query: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isRoleFact(
    content: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isFocusFact(
    content: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isOpenLoopFact(
    content: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isBlockerFact(
    content: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isProjectStateFact(
    content: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isPersonalEvidenceSignal(
    content: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isPreferenceEvidenceSignal(
    content: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  detectFactPolarity(
    content: string,
    context: ResolvedLanguageContext | string,
  ): "positive" | "negative" | "unknown";
  isAssistantAcknowledgement(
    content: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isAssistantContinuitySignal(
    content: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  isUnresolvedSignal(
    content: string,
    context: ResolvedLanguageContext | string,
  ): boolean;
  deriveFeedbackKind(
    signal: string,
    context: ResolvedLanguageContext | string,
  ): FeedbackKind;
}
