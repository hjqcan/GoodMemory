import type {
  DurableTargetIdentity,
  MemoryCandidate,
  MemoryCandidateMetadata,
  ProfileField,
} from "../domain/memoryCandidate";
import {
  createAliasedDurableTargetIdentity,
  createLanguageDurableOptOutDisposition,
  deriveLanguageDurableTarget,
} from "./durableTarget";
import type {
  LanguageCandidateExtractionInput,
  LanguageContentAnalysis,
  LanguagePack,
} from "./contracts";
import type {
  FactKind,
  MemoryScopeKind,
  ReferenceKind,
} from "../domain/records";
import { extractReferencePointer } from "../domain/referencePointer";
import {
  collectProtectedRetrievalTokens,
  expandExplicitFactCandidateClauses,
  hasUnterminatedQuote,
  isExplicitlyQuotedValue,
  isolateDirectiveGrammar,
  maskQuotedText,
  normalizeUnicodeForEquality,
  splitClausesGeneric,
  splitTrailingClause,
  tokenizeUnicodeText,
} from "./generic";
import type { DirectiveGrammarMatch } from "./generic";
import {
  acceptsEnglishEntityCandidate,
  analyzeEnglishContent as analyzeEnglishContentBase,
  analyzeEnglishQuery,
  decomposeEnglishQuery,
  extractEnglishEntityMentions,
  parseEnglishTemporalExpressions,
  renderEnglish,
} from "./englishSemantics";
import {
  createSourceOfTruthReferenceCandidate,
  matchesNormalizedEntityAlias,
  splitSentencesGeneric,
} from "./packHelpers";
import { analyzeEnglishBehavioralRule } from "./englishBehavioral";
import {
  canResolveOccurrenceExpression,
  maskQuotedTemporalLiterals,
} from "./temporal";

const BEHAVIORAL_RULE_PATTERNS = {
  firstAction: [
    /\b(?:use|run|call|invoke|execute)\s+([A-Za-z_][A-Za-z0-9_@.-]*)\b[^.\n]{0,80}\b(?:first|before)\b/iu,
    /\b(?:first|before)[^.\n]{0,40}\b(?:use|run|call|invoke|execute)\s+([A-Za-z_][A-Za-z0-9_@.-]*)\b/iu,
    /\b([A-Za-z_][A-Za-z0-9_@.-]*)\s+(?:takes|uses|requires|accepts)\b[^.\n]{0,100}\bfirst\b/iu,
  ],
  format: /\b(?:closing|end with|opening|prefix|sign off|signature|start with|subject line|suffix)\b/iu,
  general: /\b(?:always|for any|in this environment|must|should|whenever|when using)\b/iu,
  negative: /\b(?:avoid|don['’]t|do not|must not|never|rather than|instead of)\b/iu,
  trigger: [
    /\bwhen\s+(.+?)(?:[,.]|$)/iu,
    /\bif\s+(.+?)(?:[,.]|$)/iu,
    /\bbefore\s+(.+?)(?:[,.]|$)/iu,
    /\bfor\s+(.+?)(?:[,.]|$)/iu,
    /\bon\s+(.+?)\s+requests?(?:[,.]|$)/iu,
  ],
} as const;

const GREETING_PATTERN = /^(hi|hello|hey|thanks|thank you|ok|okay)[.!]?$/i;
const ENGLISH_DURABLE_TARGET_ALIASES = {
  "current project": "profile:currentProject",
  location: "profile:location",
  "language preference": "profile:languagePreference",
  "my current project": "profile:currentProject",
  "my location": "profile:location",
  "my name": "profile:name",
  "my organization": "profile:organization",
  "my preferred language": "profile:languagePreference",
  "my role": "profile:role",
  "my timezone": "profile:timezone",
  name: "profile:name",
  organization: "profile:organization",
  "preferred language": "profile:languagePreference",
  preference: "preference",
  preferences: "preference",
  "project code": "project_code",
  "project codename": "project_code",
  role: "profile:role",
  "time zone": "profile:timezone",
  timezone: "profile:timezone",
} as const;

function deriveEnglishDurableTarget(
  candidate: MemoryCandidate,
): DurableTargetIdentity | undefined {
  const structured = deriveLanguageDurableTarget(
    candidate,
    ENGLISH_DURABLE_TARGET_ALIASES,
  );
  if (structured || candidate.kindHint !== "fact") {
    return structured;
  }
  const copula = candidate.content.match(
    /^\s*(.+?)\s+is\s+(\S(?:.*?\S)?)\s*[.]?\s*$/iu,
  );
  return copula?.[1] && copula[2]
    ? createAliasedDurableTargetIdentity(
      copula[1],
      copula[2],
      ENGLISH_DURABLE_TARGET_ALIASES,
    )
    : undefined;
}

function attachEnglishDurableTarget(candidate: MemoryCandidate): MemoryCandidate {
  const durableTarget = deriveEnglishDurableTarget(candidate);
  return durableTarget ? { ...candidate, durableTarget } : candidate;
}
const IRREGULAR_EVENT_PREDICATES: Readonly<Record<string, string>> = {
  ate: "eat",
  eaten: "eat",
  met: "meet",
};

function englishEventPredicate(text: string): string | undefined {
  return text.match(
    /\b(?:did|have|has|had)\s+(?:i|we)\s+([a-z]+)\b/iu,
  )?.[1]?.toLowerCase() ?? text.match(
    /^\s*(?:i|we)\s+(?:(?:have|had)\s+)?([a-z]+)\b/iu,
  )?.[1]?.toLowerCase();
}

function englishPredicateForms(predicate: string): Set<string> {
  const forms = new Set([predicate]);
  const irregular = IRREGULAR_EVENT_PREDICATES[predicate];
  if (irregular) {
    forms.add(irregular);
  }
  if (predicate.endsWith("ied") && predicate.length > 3) {
    forms.add(`${predicate.slice(0, -3)}y`);
  }
  if (predicate.endsWith("ed") && predicate.length > 3) {
    forms.add(predicate.slice(0, -2));
    forms.add(predicate.slice(0, -1));
  }
  if (predicate.endsWith("ing") && predicate.length > 4) {
    forms.add(predicate.slice(0, -3));
    forms.add(`${predicate.slice(0, -3)}e`);
  }
  return forms;
}

function matchesEnglishEventPredicate(query: string, candidate: string): boolean {
  const queryPredicate = englishEventPredicate(query);
  const candidatePredicate = englishEventPredicate(candidate);
  if (!queryPredicate || !candidatePredicate) {
    return false;
  }
  const queryForms = englishPredicateForms(queryPredicate);
  return [...englishPredicateForms(candidatePredicate)].some((form) =>
    queryForms.has(form)
  );
}
const PROFILE_NAME_PATTERN =
  /\b[Mm]y\s+[Nn]ame\s+[Ii]s\s+((?:\p{Lu}\.|[\p{Lu}][\p{L}\p{M}'’-]*)(?:\s+(?:\p{Lu}\.|[\p{Lu}][\p{L}\p{M}'’-]*)){0,2})(?=\s*(?:[,.!?]|\band\b|$))/u;
const PROFILE_ROLE_WITH_ORGANIZATION_AND_LOCATION_PATTERN =
  /(?:remember that\s+)?i(?:'m| am)\s+(?:an?|the)\s+(.+?)\s+at\s+([A-Z][A-Za-z0-9&.,' -]*?)\s+in\s+([A-Z][A-Za-z.-]*(?:\s+[A-Z][A-Za-z.-]*)*(?:,\s*[A-Z][A-Za-z.-]*(?:\s+[A-Z][A-Za-z.-]*)*)?)(?=\.|$)/i;
const PROFILE_ROLE_WITH_ORGANIZATION_PATTERN =
  /(?:remember that\s+)?i(?:'m| am)\s+(?:an?|the)\s+(.+?)\s+at\s+([A-Z][A-Za-z0-9&.,' -]*?)(?=\.|$)/i;
const PROFILE_ROLE_WITH_LOCATION_PATTERN =
  /(?:remember that\s+)?i(?:'m| am)\s+(?:an?|the)\s+(.+?)\s+in\s+([A-Z][A-Za-z.-]*(?:\s+[A-Z][A-Za-z.-]*)*(?:,\s*[A-Z][A-Za-z.-]*(?:\s+[A-Z][A-Za-z.-]*)*)?)(?=\.|\s+(?:remember|working|leading|based)\b|,?\s+(?:remember|working|leading|based)\b|$)/i;
const PROFILE_ROLE_DRIFT_WITH_PROJECT_PATTERN =
  /(?:remember that\s+)?i(?:\s+have)?\s+now\s+moved\s+into\s+(?:an?|the)\s+(.+?)\s+leading\s+(.+?)(?=\.|$)/i;
const PROFILE_ROLE_PATTERN =
  /(?:remember that\s+)?i(?:'m| am)\s+(?:an?|the)\s+([a-z][a-z -]*(?:\s+[a-z][a-z -]*)*)(?=[.!?,]|$)/i;
const PROFILE_LOCATION_PATTERN =
  /(?:remember that\s+)?i(?:'m| am)\s+in\s+([A-Z][A-Za-z.-]*(?:\s+[A-Z][A-Za-z.-]*)*(?:,\s*[A-Z][A-Za-z.-]*(?:\s+[A-Z][A-Za-z.-]*)*)?)(?=\.|\s+(?:remember|working|leading|based)\b|,?\s+(?:remember|working|leading|based)\b|$)/i;
const PROFILE_TIMEZONE_PATTERN =
  /(?:my\s+timezone\s+is|timezone:)\s*([A-Za-z0-9_./+-]+(?:\s*[A-Za-z0-9_./+-]+)*)/i;
const PROFILE_LANGUAGE_PATTERN =
  /(?:my\s+preferred\s+language\s+is|my\s+language\s+is)\s+([A-Za-z][A-Za-z -]*)/i;
const CURRENT_PROJECT_PATTERN =
  /(?:remember that\s+)?i(?:'m| am)\s+(?:leading|working on|focused on|owning)\s+(.+?)(?=\.|$)/i;
const CURRENT_GOAL_PATTERN = /\bmy current goal is\s+(.+?)(?=[.!?]|$)/iu;
const QUARTERLY_PRIORITY_PATTERN =
  /\bmy top priority this quarter is\s+(.+?)(?=[.!?]|$)/iu;
const HABIT_PATTERN = /\bmy habit is\s+(.+?)(?=[.!?]|$)/iu;
const COACHING_STYLE_PATTERN = /\bplease coach me with\s+(.+?)(?=[.!?]|$)/iu;
const POSITIVE_COACHING_FEEDBACK_PATTERN =
  /\bkeep doing\s+(.+?)(?=[.!?]|$)/iu;
const EDUCATION_DEGREE_PATTERN =
  /\bi\s+(?:graduated|earned|have|hold)\s+(?:with\s+)?(?:a\s+)?degree\s+in\s+([^,.!?]+)(?=[,.!?]|$)/i;
const PET_NAME_PATTERN =
  /\bmy\s+(cat|dog|puppy|kitten|pet)(?:['’]s)?\s+name\s+is\s+([A-Z][A-Za-z'’-]{1,40})(?=\s*(?:[,.;!?]|\band\b|$))/i;
const PET_BREED_LIKE_PATTERN =
  /\b(?:suit|for)\s+(?:an?\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s+like\s+([A-Z][A-Za-z'’-]{1,40})\b/i;
const PET_BREED_ASSERTION_PATTERN =
  /\bmy\s+dog\s+([A-Z][A-Za-z'’-]{1,40})\s+is\s+(?:an?\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})(?=[,.!?]|$)/i;
const UNDERGRAD_INSTITUTION_PATTERN =
  /\bi\s+completed\s+my\s+(?:undergrad|undergraduate(?:\s+degree)?|bachelor['’]?s(?:\s+degree)?)\s+in\s+([^,.!?]+?)\s+from\s+([A-Z][A-Za-z0-9&.' -]{1,80}?)(?=\s*(?:[,.;!?]|\bwhich\b|$))/i;
const FIRST_PERSON_USE_PATTERN =
  /\bi(?:'ve| have)?\s+(?:been\s+)?using\s+(.+?)(?=[.!?]|$)/i;
const PERSONAL_ATTRIBUTE_PATTERN =
  /\bmy\s+([^,.!?]+?)(?:,\s+which)?\s+takes\s+([^,.!?]+?)(?=[,.!?]|$)/i;
const OPEN_LOOP_PATTERN =
  /\bi\s+(still\s+)?(?:need|have)\s+to\s+([^.!?]+?)(?=[.!?]|$)/i;
const PLANNED_OPEN_LOOP_PATTERN =
  /\bi(?:'ll| will)\s+([^.!?]+?)(?=[.!?]|$)/i;
const RECENT_EVENT_PATTERN =
  /\bi\s+(?:actually|just|recently|today|yesterday|last\s+\w+)\s+([A-Za-z][A-Za-z'’-]*(?:\s+(?:in|off|on|out|up))?)\s+([^,.!?]+?)(?=[,.!?]|$)/i;
const COMPLETED_FIRST_PERSON_EVENT_PATTERN =
  /^i(?:'ve| have)?\s+(?:(?:actually|already|just|recently)\s+)*(?:[a-z][a-z'’-]*(?:ed|aught|ought|ept)|ate|became|began|bought|built|came|did|drank|drove|felt|found|gave|got|had|heard|kept|knew|left|lost|made|met|paid|ran|read|said|saw|sent|spoke|spent|took|went|won|wrote)\b/iu;
const PERSONAL_BEST_TIME_PATTERN =
  /\bpersonal best time(?:\s+in\s+(.+?))?\s+(?:with a time of|of)\s+([0-9]{1,2}:[0-9]{2}|[0-9]+\s+minutes?(?:\s+and\s+[0-9]+\s+seconds?)?)(?=\s|[,.!?]|$)/i;
const LEARNING_WITH_TOOL_PATTERN =
  /\bi(?:'m| am)\s+trying\s+to\s+learn\s+more\s+about\s+(.+?)\s+with\s+(.+?),\s+which\s+i\s+enjoy\s+to\s+use\b/i;
const CURRENT_PROJECT_INVOLVEMENT_PATTERN =
  /\bi(?:'m| am|(?:'ve| have)\s+been|(?:\s+also)?\s+started)\s+working\s+on\s+([^,.!?]+?)(?=[,.!?]|$)/i;
const PROJECT_LEADERSHIP_PATTERN =
  /\bi\s+led\s+([^,.!?]+?)(?=\s+and\b|[,.!?]|$)/i;
const PROJECT_LEADERSHIP_CONTEXT_PATTERN =
  /\b(?:in|from)\s+my\s+([^,.!?]*?\bproject\b[^,.!?]*?)[,.]?\s+(?:where\s+)?i\s+led\b/i;
const PROJECT_ACTIVITY_PATTERN =
  /\bi\s+(?:recently\s+)?(participated\s+in|presented)\s+([^,.!?]+?)(?=[,.!?]|$)/i;
const RELATION_RELOCATION_WHO_PATTERN =
  /\bmy\s+(?:friend|cousin|aunt|uncle|sister|brother|partner|colleague)\s+([A-Z][A-Za-z'-]+)\s+who\s+(?:recently\s+|just\s+)?moved\s+(back\s+)?to\s+([^,.!?]+?)(?=[,.!?]|$)/i;
const RELATION_RELOCATION_DIRECT_PATTERN =
  /\bmy\s+(?:friend|cousin|aunt|uncle|sister|brother|partner|colleague)\s+([A-Z][A-Za-z'-]+)\s+(?:actually\s+)?(?:recently\s+|just\s+)?moved\s+(back\s+)?to\s+([^,.!?]+?)(?=[,.!?]|$)/i;
const USER_IDENTITY_PATTERN =
  /^as\s+(?:an?\s+)?([^,.!?]+?)\s+user\s*,/i;
const EXPLICIT_FACT_DIRECTIVE_PATTERN =
  /^(?:please\s*,?\s+)?remember\s+(?:(?:that|this)\b|(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+things?\b)\s*[:：,]?\s*/iu;
const COUNTED_EXPLICIT_FACT_DIRECTIVE_PATTERN =
  /^(?:please\s*,?\s+)?remember\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+things?\b/iu;
const REMEMBER_QUESTION_PATTERN =
  /^(?:do|did|can|could|would|will)\s+you\s+remember\b.*\?$/iu;
const ENGLISH_INTERROGATIVE_ANCHORS = [
  "what",
  "who",
  "whom",
  "whose",
  "which",
  "where",
  "when",
  "why",
  "how",
] as const;
const ENGLISH_INTERROGATIVE_HOW_MODIFIERS = [
  "far",
  "long",
  "many",
  "much",
  "often",
  "old",
] as const;
const ENGLISH_INTERROGATIVE_ANCHOR_SOURCE =
  `(?:${ENGLISH_INTERROGATIVE_ANCHORS.join("|")})`;
const ENGLISH_LEADING_INTERROGATIVE_ANCHOR_PATTERN = new RegExp(
  `^${ENGLISH_INTERROGATIVE_ANCHOR_SOURCE}\\b`,
  "iu",
);
const ENGLISH_NOMINAL_CLAUSE_ASSERTION_PATTERN = new RegExp(
  `^(?:(?:${ENGLISH_INTERROGATIVE_ANCHOR_SOURCE})\\s+matters?|(?:${ENGLISH_INTERROGATIVE_ANCHOR_SOURCE})\\s+(?:i|we|you|he|she|it|they)\\s+[^?]+?|(?:what|who)\\s+\\p{L}+(?:s|ed)\\s+[^?]+?)\\s+(?:is|are|was|were|depends?|determines?|remains?|means?)\\s+[^?]+[.!]?$|^how\\s+[^?]+?\\s+(?:remains?|is|was)\\s+(?:unclear|unknown|unresolved|undocumented)[.!]?$`,
  "iu",
);
const EXPLICIT_FACT_QUESTION_CLAUSE_PATTERN = new RegExp(
  `^(?:${ENGLISH_INTERROGATIVE_ANCHOR_SOURCE}\\b|(?:is|are|am|was|were|do|does|did|can|could|would|will|should)\\s+(?:i|we|you|he|she|it|they|my|our|your|his|her|their|there|the|this|that)\\b)`,
  "iu",
);
const EXPLICIT_FACT_POSTPOSED_QUESTION_VALUE_PATTERN = new RegExp(
  `[,，、]\\s*${ENGLISH_INTERROGATIVE_ANCHOR_SOURCE}(?:\\s+(?:exactly|one|ones))?\\s*\\?\\s*$`,
  "iu",
);
const EXPLICIT_FACT_UNPUNCTUATED_QUESTION_PATTERN = new RegExp(
  `\\b(?:is|are|was|were)\\s+${ENGLISH_INTERROGATIVE_ANCHOR_SOURCE}\\s*$`,
  "iu",
);
const ENGLISH_TERMINAL_INTERROGATIVE_PATTERN = new RegExp(
  `\\b${ENGLISH_INTERROGATIVE_ANCHOR_SOURCE}\\s*$`,
  "iu",
);
const ENGLISH_CLEAR_TRAILING_QUESTION_PATTERN = new RegExp(
  `^${ENGLISH_INTERROGATIVE_ANCHOR_SOURCE}(?:\\s+exactly)?\\s+(?:am|is|are|was|were|do|does|did|can|could|would|will|should|have|has|had)\\b`,
  "iu",
);
const ENGLISH_CONFIRMATION_QUESTION_PATTERN =
  /,\s*(?:right|correct|yeah|isn['’]t it)\s*[.!]*$/iu;
const EXPLICIT_FACT_OPT_OUT_PATTERN =
  /^(?:please\s*,?\s+)?(?:do\s+not|don['’]t|never)\s+(?:remember|save|store|record)\b/iu;
const EXPLICIT_FACT_OPT_OUT_GRAMMAR_PATTERN =
  /(?:please\s*,?\s+)?(?:do\s+not|don['’]t|never)\s+(?:remember|save|store|record)\b/iu;
const EXPLICIT_FACT_OPT_OUT_CLAUSE_BOUNDARY_PATTERN =
  /(?:,\s*|^(?:and|but)\s+|\s+(?:and|but)\s+)(?=(?:please\s*,?\s+)?(?:do\s+not|don['’]t|never)\s+(?:remember|save|store|record)\b)/iu;
const EXPLICIT_FACT_OPT_OUT_CONNECTOR_BOUNDARY_PATTERN =
  /(?:^(?:and|but)\s+|\s+(?:and|but)\s+)(?=(?:please\s*,?\s+)?(?:do\s+not|don['’]t|never)\s+(?:remember|save|store|record)\b)/iu;
const ENGLISH_REPORTED_DIRECTIVE_PREFIX_PATTERN =
  /(?:^|[.!?]\s*)(?:[\p{L}\p{N}'’.-]+\s+){0,5}(?:(?:do|does|did|am|is|are|was|were|have|has|had|will|would|can|could|should)\s+not\s+|never\s+)?(?:say|said|tell|told|ask|asked|mean|meant|request(?:ed)?|claim(?:ed)?|write|wrote|quote(?:d)?)(?:\s+that)?\s*$/iu;

function hasEnglishReportedDirectiveScope({
  prefix,
}: DirectiveGrammarMatch): boolean {
  return ENGLISH_REPORTED_DIRECTIVE_PREFIX_PATTERN.test(prefix);
}
const EXPLICIT_FACT_ASSIGNMENT_CONFIRMATION_PATTERN =
  /\b(?:correct|right|true|accurate)\s*\?\s*$/iu;
const EXPLICIT_DECISION_PATTERN =
  /\b(?:we decided|canonical source of truth|must remain)\b/i;
const FOLLOW_UP_OPEN_LOOP_PATTERN =
  /\bstill\s+have\s+an?\s+open\s+loop\s+on\s+(.+?)(?=\.|$)/i;
const PREFERENCE_PATTERN = /i prefer\s+(.+?)(?:\.|$)/i;
const ENGLISH_CORRECTION_PREAMBLE_PATTERN =
  /^(?:correction|that approach was wrong|wrong|not right)\b\s*(?:[:;,.-]\s*)?/iu;
const ENGLISH_SELF_CONTAINED_CORRECTION_PATTERN =
  /^(?:that approach was wrong|wrong|not right)\b/iu;
const NEVER_MIND_PATTERN = /^never mind\b/i;
const ENGLISH_BEHAVIORAL_PREAMBLE_PATTERN =
  /^(?:please|(?:could|can|would)\s+you\s+please)$/iu;
const ENGLISH_BEHAVIORAL_DIRECTIVE_PATTERN =
  /^(?:(?:could|can|would)\s+you\s+please\s*,?\s+|please\s*,?\s+|you\s+should\s+(?:not\s+)?)?(?:do\s+not|don['’]t|keep|provide|make|give|use|avoid|prioritize|format|structure|focus|be|continue|answer|reply|respond|read|write|create|tell|show|send|open|close|delete|move|copy|run|call|publish|coach|check|inspect|verify|fix|summarize|implement|explain|discuss|analyze|add|update|review|debug|refactor|deploy)\b/iu;
const ENGLISH_POLITE_BEHAVIORAL_DIRECTIVE_PATTERN =
  /^(?:(?:could|can|would)\s+you\s+please|please)\s*,?\s+\p{L}+\b/iu;
const ENGLISH_STRUCTURAL_BEHAVIORAL_DIRECTIVE_PATTERN =
  /^(?!(?:i|we|you|he|she|it|they)(?:['’][a-z]+)?\s)\p{L}+(?:['’-]\p{L}+)*\s+(?:why|how|what|where|when|whether)\b/iu;
const ENGLISH_DURABLE_BEHAVIORAL_SCOPE_PATTERN =
  /^(?:always|never|remember\s+to)\b|\b(?:always|from\s+now\s+on|going\s+forward|next\s+time|every\s+time|in\s+every\s+(?:answer|reply|response)|whenever)\b/iu;
const ENGLISH_LEADING_DURABLE_BEHAVIORAL_SCOPE_PATTERN =
  /^(?:(?:from\s+now\s+on|going\s+forward|next\s+time|every\s+time|always|never)\b[,;:]?\s*)+/iu;
const PROJECT_POLICY_ACTION_PATTERN =
  /\b(?:must|shall|uses?|forbids?|allows?|defaults?|represents?|wraps?|leaves?|keeps?|routes?|rejects?|stores?|retains?|removes?|runs?|writes?|reads?|treats?|maps?|converts?|passes?\s+through)\b/iu;
const PROJECT_POLICY_DECLARATION_PATTERN =
  /\b(?:the\s+)?(?:project|repository|repo)\s+policy\s*(?:(:|=)\s*([^\n]+)|mandates?\s+that\s+([^\n]+)|is\s+that\s+([^\n]+)|is\s+to\s+([^\n]+))/iu;
const TECHNICAL_REFERENCE_DIRECTIVE_PATTERN =
  /\b(?:consult|follow|refer(?:ence)?\s+to|reference|see|use)\b/iu;
const DURABLE_INFERENCE_PATTERNS = [
  /\b(currently|still|blocked|failing|working on|responsible for)\b/i,
  /\b(workflows?|migrations?|production|prod|projects?|roadmaps?|deadlines?|launch(?:es)?)\b/i,
  /\b(apis?|runtimes?|builds?|schemas?|incidents?|bugs?|errors?)\b/i,
];
const PROJECT_FACT_PATTERNS = [
  /\bworkflows?\b/i,
  /\bblockers?\b/i,
  /\bopen loops?\b/i,
  /\bhandoffs?\b/i,
  /\bmilestones?\b/i,
  /\bvalidations?\b/i,
  /\bsignoffs?\b/i,
  /\breadiness\b/i,
  /\bcutover\b/i,
  /\breviews?\b/i,
  /\bprojects?\b/i,
  /\brunbooks?\b/i,
  /\bplaybooks?\b/i,
  /\brollouts?\b/i,
  /\bapprovals?\b/i,
  /\broadmaps?\b/i,
  /\bmigrations?\b/i,
  /\blaunch(?:es)?\b/i,
  /\bproduction\b/i,
  /\bprod\b/i,
  /\bfollow(?:-| )?up\b/i,
];
const TECHNICAL_FACT_PATTERNS = [
  /\bservices?\b/i,
  /\bfeatures?\b/i,
  /\bdependenc(?:y|ies)\b/i,
  /\bpipelines?\b/i,
  /\bapis?\b/i,
  /\bruntimes?\b/i,
  /\bbugs?\b/i,
  /\berrors?\b/i,
  /\bbuilds?\b/i,
  /\bschemas?\b/i,
];
const PROFILE_LIKE_PROJECT_FACT_PATTERNS = [
  /\bblockers?\b/i,
  /\bopen loops?\b/i,
  /\bsource of truth\b/i,
  /\brunbooks?\b/i,
  /\bhandoffs?\b/i,
  /\bapprovals?\b/i,
  /\bblocked\b/i,
  /\bfailing\b/i,
  /\bdeadlines?\b/i,
  /\blaunch(?:es)?\b/i,
  /\bmigrations?\b/i,
  /\bprojects?\b/i,
  /\bworkflows?\b/i,
];
const TOKEN_STOPWORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "should",
  "answer",
  "reply",
  "respond",
  "user",
  "using",
  "current",
  "please",
  // Short function words: the token filter keeps tokens down to length 2 so
  // acronyms and codes ("RL", "SF", "v2") stay searchable; these carry no
  // retrieval signal and are excluded wherever excludeStopwords is requested.
  "am",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "before",
  "but",
  "by",
  "did",
  "do",
  "for",
  "had",
  "has",
  "he",
  "her",
  "him",
  "his",
  "if",
  "i'm",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "no",
  "nor",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "the",
  "to",
  "too",
  "up",
  "us",
  "was",
  "we",
  ...ENGLISH_INTERROGATIVE_ANCHORS,
  "you",
]);

function filterEnglishRetrievalTokens(
  text: string,
  minimumLength: number,
  keepBefore = false,
): string[] {
  const protectedTokens = collectProtectedRetrievalTokens(text, "en-US");
  const unquoted = maskQuotedText(text);
  const howModifiers = new Set<string>(
    ENGLISH_INTERROGATIVE_HOW_MODIFIERS.filter((modifier) =>
      new RegExp(`\\bhow\\s+${modifier}\\b`, "iu").test(unquoted)
    ),
  );
  return tokenizeUnicodeText(text, "en-US").filter((token) =>
    token.length >= minimumLength &&
    (protectedTokens.has(token) ||
      (((!TOKEN_STOPWORDS.has(token) || (keepBefore && token === "before"))) &&
        !howModifiers.has(token)))
  );
}
const ENGLISH_SUBJECT_TAIL_PATTERN =
  /\b(?:and|but)\s+(?:driving|tracking|keeping|handling|reviewing|planning|shipping|rolling|migrating|preparing|finalizing|waiting|coordinating|owning)\b.*$/i;
const ENGLISH_SUBJECT_CLAUSE_PATTERN =
  /\b(?:while|because|after|before|when|if)\b.*$/i;
const ENGLISH_SUBJECT_PREDICATE_BOUNDARY_PATTERN =
  /\s+(?:is|are|was|were|remains?|stays?|needs?|requires?|has|have)\b/gi;

function splitEnglishClauses(text: string): string[] {
  return splitClausesGeneric(text)
    .filter(Boolean)
    .flatMap((clause) => clause.split(/,\s*\bbut\b\s+/iu))
    .flatMap((clause) =>
      EXPLICIT_FACT_DIRECTIVE_PATTERN.test(clause.trim()) ||
        EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : splitTrailingClause(
          clause,
          (candidate) => isEnglishInterrogativeClause(candidate, candidate),
          (candidate) =>
            /\?\s*$/u.test(maskQuotedText(candidate)) ||
            ENGLISH_CLEAR_TRAILING_QUESTION_PATTERN.test(
              maskQuotedText(candidate).trim(),
            ),
        )
    )
    .flatMap((clause) =>
      EXPLICIT_FACT_DIRECTIVE_PATTERN.test(clause.trim()) ||
        EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : splitTrailingClause(
          clause,
          (candidate) =>
            classifyEnglishBehavioralDirective(candidate) !== "none" ||
            ENGLISH_DURABLE_BEHAVIORAL_SCOPE_PATTERN.test(
              maskQuotedText(candidate).trim(),
            ),
          (candidate) =>
            classifyEnglishBehavioralDirective(candidate) !== "none",
          (candidate) =>
            ENGLISH_BEHAVIORAL_PREAMBLE_PATTERN.test(candidate.trim()),
        )
    )
    .flatMap((clause) =>
      clause.split(EXPLICIT_FACT_OPT_OUT_CONNECTOR_BOUNDARY_PATTERN)
    )
    .map((clause) =>
      isolateDirectiveGrammar(
        clause,
        EXPLICIT_FACT_OPT_OUT_GRAMMAR_PATTERN,
        hasEnglishReportedDirectiveScope,
      )
    )
    .flatMap((clause) =>
      EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : clause.split(EXPLICIT_FACT_OPT_OUT_CLAUSE_BOUNDARY_PATTERN)
    )
    .filter(Boolean);
}

function cleanExplicitFactContent(value: string): string {
  return value
    .trim()
    .replace(EXPLICIT_FACT_DIRECTIVE_PATTERN, "")
    .replace(/^[：:,;；\s]+/u, "")
    .replace(/[：:,;；]+$/u, "")
    .trim();
}

function extractEnglishOptOutTarget(content: string): string {
  return content
    .replace(EXPLICIT_FACT_OPT_OUT_PATTERN, "")
    .replace(/^\s*(?:that\b\s*)?[:：,]?\s*/iu, "")
    .trim();
}

function splitEnglishExplicitFactClauses(
  content: string,
  countedList: boolean,
): string[] {
  const clauses = splitEnglishClauses(content);
  return countedList
    ? clauses.flatMap((clause) =>
      clause.split(
        /(?<!\b\p{L}\.\p{L})\.\s+(?=[\p{L}\p{N}_ -]{1,80}\s*[=＝])/u,
      )
    )
    : clauses;
}

function isEnglishInterrogativeClause(
  content: string,
  source: string,
): boolean {
  const unquotedContent = maskQuotedText(content).trim();
  const unquotedSource = maskQuotedText(source).trim();
  if (ENGLISH_CONFIRMATION_QUESTION_PATTERN.test(unquotedContent)) {
    return true;
  }
  const leadingCommaIndex = unquotedContent.search(/[,，]/u);
  if (
    !/\?\s*$/u.test(unquotedSource) &&
    leadingCommaIndex >= 0 &&
    ENGLISH_LEADING_INTERROGATIVE_ANCHOR_PATTERN.test(unquotedContent)
  ) {
    const mainClause = unquotedContent.slice(leadingCommaIndex + 1).trim();
    if (!isEnglishInterrogativeClause(mainClause, mainClause)) {
      return false;
    }
  }
  const assignmentIndex = content.search(/[=＝]/u);
  if (assignmentIndex >= 0) {
    const left = content.slice(0, assignmentIndex).trim();
    const right = content.slice(assignmentIndex + 1).trim();
    if (EXPLICIT_FACT_QUESTION_CLAUSE_PATTERN.test(left)) {
      return true;
    }
    const assignmentConfirmation =
      EXPLICIT_FACT_ASSIGNMENT_CONFIRMATION_PATTERN.test(right);
    if (assignmentConfirmation) {
      return true;
    }
    if (hasUnterminatedQuote(right)) {
      return true;
    }
    if (isExplicitlyQuotedValue(right)) {
      return false;
    }
    if (EXPLICIT_FACT_POSTPOSED_QUESTION_VALUE_PATTERN.test(right)) {
      return true;
    }
    if (/\?\s*$/u.test(unquotedSource)) {
      return true;
    }
    return false;
  }
  if (
    !/\?\s*$/u.test(unquotedSource) &&
    ENGLISH_NOMINAL_CLAUSE_ASSERTION_PATTERN.test(unquotedContent) &&
    !ENGLISH_TERMINAL_INTERROGATIVE_PATTERN.test(unquotedContent)
  ) {
    return false;
  }

  const startsWithInterrogativeAnchor =
    ENGLISH_LEADING_INTERROGATIVE_ANCHOR_PATTERN.test(unquotedContent);
  const hasDeclarativeTerminator = /[.!]\s*$/u.test(unquotedSource);

  return /\?\s*$/u.test(unquotedSource) ||
    EXPLICIT_FACT_UNPUNCTUATED_QUESTION_PATTERN.test(unquotedContent) ||
    ENGLISH_TERMINAL_INTERROGATIVE_PATTERN.test(unquotedContent) ||
    (EXPLICIT_FACT_QUESTION_CLAUSE_PATTERN.test(unquotedContent) &&
      (!startsWithInterrogativeAnchor ||
        ENGLISH_CLEAR_TRAILING_QUESTION_PATTERN.test(unquotedContent) ||
        !hasDeclarativeTerminator) &&
      !/^(?:do|does|did|is|are|am|was|were|has|have|had|can|could|should|would|will)\s+not\b/iu.test(
        unquotedContent,
      ));
}

function extractExplicitFactClauses(content: string) {
  const trimmed = content.trim();
  if (EXPLICIT_FACT_OPT_OUT_PATTERN.test(trimmed)) {
    return {
      clauses: [{ content: trimmed, disposition: "feedback" as const }],
      status: "complete" as const,
    };
  }

  const directive = trimmed.match(EXPLICIT_FACT_DIRECTIVE_PATTERN);
  if (!directive) {
    return undefined;
  }

  const countMatch = trimmed.match(COUNTED_EXPLICIT_FACT_DIRECTIVE_PATTERN);
  const countToken = countMatch?.[1]?.toLowerCase();
  const numericCount = Number(countToken);
  const wordCounts: Readonly<Record<string, number>> = {
    eight: 8,
    five: 5,
    four: 4,
    nine: 9,
    one: 1,
    seven: 7,
    six: 6,
    ten: 10,
    three: 3,
    two: 2,
  };
  const expectedFactCount = countToken
    ? Number.isInteger(numericCount) && numericCount >= 0
      ? numericCount
      : wordCounts[countToken] ?? 1
    : 1;
  const clauses = splitEnglishExplicitFactClauses(
    trimmed.slice(directive[0].length),
    countMatch !== null,
  )
    .map((source) => ({
      content: cleanExplicitFactContent(source),
      source,
    }));
  const factClauses = clauses.filter(({ content: clause }) =>
    /[\p{L}\p{N}]/u.test(clause)
  );
  if (factClauses.length < expectedFactCount) {
    return countMatch
      ? {
        clauses: factClauses.map(({ content: clause }) => ({
          content: clause,
          disposition: EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause)
            ? "feedback" as const
            : "fact" as const,
        })),
        status: "incomplete-counted-list" as const,
      }
      : { clauses: [], status: "invalid" as const };
  }
  if (clauses.some(({ content: clause, source }) =>
    !EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause) &&
    isEnglishInterrogativeClause(clause, source)
  )) {
    return { clauses: [], status: "invalid" as const };
  }

  return {
    clauses: factClauses
      .slice(0, expectedFactCount)
      .map(({ content: clause }) => ({
        content: clause,
        disposition: EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause)
          ? "feedback" as const
          : "fact" as const,
      })),
    status: "complete" as const,
  };
}

function analyzeEnglishContent(content: string): LanguageContentAnalysis {
  const analysis = analyzeEnglishContentBase(content);
  return {
    ...analysis,
    ...( /^\s*(?:warning|caution)\s*:/iu.test(content)
      ? { factPolarity: "negative" as const }
      : {}),
    behavioralDirective: classifyEnglishBehavioralDirective(
      content,
      analysis,
    ),
    interrogative: isEnglishInterrogativeClause(content, content),
  };
}

function classifyEnglishBehavioralDirective(
  content: string,
  analysis = analyzeEnglishContentBase(content),
): NonNullable<LanguageContentAnalysis["behavioralDirective"]> {
  const trimmed = content.trim();
  if (
    EXPLICIT_FACT_DIRECTIVE_PATTERN.test(trimmed) ||
    EXPLICIT_FACT_OPT_OUT_PATTERN.test(trimmed) ||
    analysis.sourceOfTruthDirective ||
    isEnglishTechnicalReferenceDirective(trimmed) ||
    NEVER_MIND_PATTERN.test(trimmed) ||
    PREFERENCE_PATTERN.test(trimmed)
  ) {
    return "none";
  }

  const unquoted = maskQuotedText(trimmed).trim();
  if (!unquoted) {
    return "none";
  }
  const correctionMatch = unquoted.match(ENGLISH_CORRECTION_PREAMBLE_PATTERN);
  const corrected = correctionMatch
    ? unquoted.slice(correctionMatch[0].length).trim()
    : unquoted;
  if (!corrected) {
    return ENGLISH_SELF_CONTAINED_CORRECTION_PATTERN.test(unquoted)
      ? "durable"
      : correctionMatch
      ? "one_off"
      : "none";
  }
  if (
    correctionMatch &&
    ENGLISH_SELF_CONTAINED_CORRECTION_PATTERN.test(corrected)
  ) {
    return "durable";
  }
  const directiveBody = corrected.replace(
    ENGLISH_LEADING_DURABLE_BEHAVIORAL_SCOPE_PATTERN,
    "",
  );
  const namedActionAssertion =
    /^(?:\p{L}+(?:['’-]\p{L}+)*\s+){1,2}(?:is|are|was|were|means|refers|remains?|has|have)\b/iu
      .test(directiveBody);
  const isBehavioralDirective = !namedActionAssertion &&
    (ENGLISH_POLITE_BEHAVIORAL_DIRECTIVE_PATTERN.test(corrected) ||
      ENGLISH_BEHAVIORAL_DIRECTIVE_PATTERN.test(corrected) ||
      ENGLISH_BEHAVIORAL_DIRECTIVE_PATTERN.test(directiveBody) ||
      ENGLISH_STRUCTURAL_BEHAVIORAL_DIRECTIVE_PATTERN.test(directiveBody) ||
      /^remember\s+to\b/iu.test(corrected));
  if (
    ENGLISH_DURABLE_BEHAVIORAL_SCOPE_PATTERN.test(corrected) &&
    isBehavioralDirective
  ) {
    return "durable";
  }
  return isBehavioralDirective ? "one_off" : "none";
}

function isEnglishTechnicalReferenceDirective(content: string): boolean {
  return TECHNICAL_REFERENCE_DIRECTIVE_PATTERN.test(content) &&
    extractReferencePointer(content) !== undefined &&
    extractReferenceSubject(content) !== undefined;
}

function deriveFactCategory(
  content: string,
): "project" | "technical" | "personal" | "relationship" | "event" {
  const normalized = content.toLowerCase();

  if (PROJECT_FACT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "project";
  }

  if (TECHNICAL_FACT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "technical";
  }

  if (
    /\bfamily\b/i.test(normalized) ||
    /\bpartner\b/i.test(normalized) ||
    /\bfriend\b/i.test(normalized)
  ) {
    return "relationship";
  }

  if (
    /\btravel\b/i.test(normalized) ||
    /\bevent\b/i.test(normalized) ||
    /\bmeeting\b/i.test(normalized)
  ) {
    return "event";
  }

  return "personal";
}

function deriveFeedbackKind(
  content: string,
  analysis?: LanguageContentAnalysis,
): "do" | "dont" | "prefer" {
  const kind = analysis?.feedbackKind ?? analyzeEnglishContent(content).feedbackKind;
  return kind === "validated_pattern" ? "do" : kind;
}

function extractStableSubject(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const cleaned = cleanExtractedValue(value)
    .toLowerCase()
    .replace(/^the\s+(?!to\b)/i, "")
    .replace(/^a\s+(?!to\b)/i, "")
    .replace(/^an\s+(?!to\b)/i, "")
    .replace(/^(?:my|current)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length >= 3 ? cleaned : undefined;
}

function trimPredicateBoundary(value: string): string {
  for (const match of value.matchAll(ENGLISH_SUBJECT_PREDICATE_BOUNDARY_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }

    const prefix = value.slice(0, match.index).trim();
    if (/\b(?:that|which|who|to)\s*$/i.test(prefix)) {
      continue;
    }

    return prefix;
  }

  return value;
}

function extractBoundedEnglishSubject(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = cleanExtractedValue(value)
    .replace(ENGLISH_SUBJECT_TAIL_PATTERN, "")
    .replace(ENGLISH_SUBJECT_CLAUSE_PATTERN, "")
    .trim();
  const bounded = trimPredicateBoundary(trimmed)
    .trim();

  return extractStableSubject(bounded);
}

function extractFactSubject(content: string): string | undefined {
  const roleProjectMatch = content.match(/\bleading\s+([^.,!?]+)/i);
  if (roleProjectMatch?.[1]) {
    return extractBoundedEnglishSubject(roleProjectMatch[1]);
  }

  const scopedMatch = content.match(/\b(?:for|on)\s+([^.,!?]+)/i);
  if (scopedMatch?.[1]) {
    return extractBoundedEnglishSubject(scopedMatch[1]);
  }

  return undefined;
}

function deriveFactKind(content: string): FactKind | undefined {
  if (/\bmy current role is\b/i.test(content)) {
    return "role_update";
  }

  if (/\bmy current focus is\b/i.test(content)) {
    return "focus_update";
  }

  if (/\bblocker\b|\bblocked\b|\bblocking\b|\bapproval\b/i.test(content)) {
    return "blocker";
  }

  if (/\bopen loop\b|\bhandoff\b|\bsignoff\b|\bverification\b/i.test(content)) {
    return "open_loop";
  }

  if (
    /\bi\s+(?:(?:still|also|just)\s+)?(?:need|have)\s+to\b/i.test(content) ||
    /\bi(?:'ve| have)\s+been\s+meaning\s+to\b/i.test(content)
  ) {
    return "open_loop";
  }

  if (
    /\b(next milestone|next step|next action|upcoming milestone|pending|waiting|remaining|still needs?|needs? review|needs? confirmation|needs? follow(?:-| )?up)\b/i.test(
      content,
    )
  ) {
    return "project_state";
  }

  if (deriveFactCategory(content) === "project" || deriveFactCategory(content) === "technical") {
    return "generic_project";
  }

  return undefined;
}

function deriveFactScopeKind(
  category: ReturnType<typeof deriveFactCategory>,
  factKind: FactKind | undefined,
): MemoryScopeKind | undefined {
  if (factKind === "role_update") {
    return "identity";
  }

  if (
    factKind === "focus_update" ||
    factKind === "blocker" ||
    factKind === "open_loop" ||
    factKind === "project_state" ||
    factKind === "generic_project"
  ) {
    return "project";
  }

  if (category === "personal" || category === "relationship" || category === "event") {
    return "identity";
  }

  if (category === "project" || category === "technical") {
    return "project";
  }

  return undefined;
}

function buildFactMetadata(
  content: string,
  categoryOverride?: "project" | "technical" | "personal" | "relationship" | "event",
): MemoryCandidateMetadata {
  const factKind = deriveFactKind(content);
  const derivedCategory = categoryOverride ?? deriveFactCategory(content);
  const category =
    derivedCategory === "personal" &&
    (factKind === "focus_update" ||
      factKind === "blocker" ||
      factKind === "open_loop" ||
      factKind === "project_state")
      ? "project"
      : derivedCategory;

  return {
    category,
    factKind,
    scopeKind: deriveFactScopeKind(category, factKind),
    subject: extractFactSubject(content) ?? "unknown",
  };
}

function deriveReferenceKind(content: string, pointer: string): ReferenceKind {
  if (/\bsource of truth\b/i.test(content)) {
    return "source_of_truth";
  }

  const basename = pointer.split("/").at(-1)?.toLowerCase() ?? pointer.toLowerCase();
  if (basename.includes("runbook")) {
    return "runbook";
  }
  if (basename.includes("dashboard")) {
    return "dashboard";
  }
  if (basename.includes("tracker")) {
    return "tracker";
  }

  return "doc";
}

function extractReferenceSubject(content: string): string | undefined {
  const match = content.match(/\bfor\s+([^.,!?]+)/i);
  return extractBoundedEnglishSubject(match?.[1]);
}

function looksLikeDurableInferredFact(content: string): boolean {
  return DURABLE_INFERENCE_PATTERNS.some((pattern) => pattern.test(content));
}

function isExplicitProjectPolicyDecision(content: string): boolean {
  const match = PROJECT_POLICY_DECLARATION_PATTERN.exec(content);
  if (!match) {
    return false;
  }
  const [, separator, assignedBody, mandatedBody, assertedBody, actionBody] = match;
  if (separator || mandatedBody) {
    return PROJECT_POLICY_ACTION_PATTERN.test(assignedBody ?? mandatedBody ?? "");
  }
  if (assertedBody) {
    return /^(?:we|the\s+(?:project|repository|repo)|this\s+(?:project|repository|repo))\s+(?:must|shall|uses?|forbids?|allows?|defaults?|represents?|wraps?|leaves?|keeps?|routes?|rejects?|stores?|retains?|removes?|runs?|writes?|reads?|treats?|maps?|converts?)\b/iu.test(
      assertedBody.trim(),
    );
  }
  return /^(?:use|forbid|allow|default|represent|wrap|leave|keep|route|reject|store|retain|remove|run|write|read|treat|map|convert|pass\s+through)\b/iu.test(
    actionBody?.trim() ?? "",
  );
}

function createProfileCandidate(
  index: number,
  nextId: () => string,
  profileField: ProfileField,
  content: string,
): MemoryCandidate {
  return {
    id: nextId(),
    kindHint: "profile",
    explicitness: "explicit",
    content,
    sourceMessageIndex: index,
    sourceRole: "user",
    metadata: {
      profileField,
    },
  };
}

function createFactCandidate(
  index: number,
  nextId: () => string,
  content: string,
  category?: "project" | "technical" | "personal" | "relationship" | "event",
  metadata?: MemoryCandidateMetadata,
): MemoryCandidate {
  return {
    id: nextId(),
    kindHint: "fact",
    explicitness: "explicit",
    content,
    sourceMessageIndex: index,
    sourceRole: "user",
    metadata: {
      ...buildFactMetadata(content, category),
      ...metadata,
    },
  };
}

function cleanExtractedValue(value: string): string {
  return value.trim().replace(/[.,]+$/, "").trim();
}

function cleanEventObject(value: string): string {
  return cleanExtractedValue(value)
    .replace(/,\s*actually$/i, "")
    .replace(/\s+(?:that|which)\s+i\b.*$/i, "")
    .trim();
}

const ENGLISH_MONTH_NAME_PATTERN =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/gu;

function maskEnglishMonthObjects(content: string): string {
  let masked = content;
  for (const match of content.matchAll(ENGLISH_MONTH_NAME_PATTERN)) {
    const start = match.index;
    const month = match[0];
    const prefix = content.slice(0, start);
    const suffix = content.slice(start + month.length);
    if (
      /\b(?:in|during|on|last|this|next)\s*$/iu.test(prefix) ||
      /^\s+(?:\d{1,2}(?:st|nd|rd|th)?(?:,|\s)|\d{4}\b)/u.test(suffix)
    ) {
      continue;
    }
    masked = masked.slice(0, start) + " ".repeat(month.length) +
      masked.slice(start + month.length);
  }
  return masked;
}

function maskEnglishTemporalLiterals(content: string): string {
  return maskEnglishMonthObjects(maskQuotedTemporalLiterals(content))
    .replace(
      /\b(?:movie|film|book|song|album|show|play)\s+(?:Yesterday|Today|Tomorrow)\b/gu,
      (title) => " ".repeat(title.length),
    )
    .replace(
      /\b(?:Yesterday|Today|Tomorrow)\b(?=[^.!?]*\b(?:yesterday|today|tomorrow)\b)/gu,
      (title) => " ".repeat(title.length),
    );
}

function isEnglishCompletedEventAssertion(content: string): boolean {
  return !(
    /[?？]/u.test(content) ||
    ENGLISH_CONFIRMATION_QUESTION_PATTERN.test(content) ||
    /\b(?:what|who|where|when|why|how)\s*[.!]?$/iu.test(content) ||
    /\b(?:did\s+not|didn['’]t|had\s+not|has\s+not|have\s+not|never)\b/iu.test(
      content,
    )
  );
}

function stripEnglishOccurrenceExpressions(
  content: string,
  maskedContent: string,
  expressions: ReadonlyArray<ReturnType<typeof parseEnglishTemporalExpressions>[number]>,
): string {
  const ranges = expressions
    .map((expression) => {
      const start = maskedContent.indexOf(expression.raw);
      return start < 0
        ? undefined
        : { end: start + expression.raw.length, start };
    })
    .filter((range): range is { end: number; start: number } => range !== undefined)
    .sort((left, right) => right.start - left.start);
  let canonical = content;
  for (const { end, start } of ranges) {
    const before = canonical.slice(0, start).replace(
      /\b(?:at|during|in|on)\s*$/iu,
      "",
    );
    canonical = `${before}${canonical.slice(end)}`;
  }
  return canonical
    .replace(/^\s*[,;:]\s*/u, "")
    .replace(/\s+([,.;!?])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function extractEnglishOccurrenceEvent(
  content: string,
  context: {
    locale: string;
    observedAt?: string;
    timezone?: string;
  },
): { content: string; occurrenceExpression: ReturnType<typeof parseEnglishTemporalExpressions>[number] } | undefined {
  if (!isEnglishCompletedEventAssertion(content)) {
    return undefined;
  }
  const maskedTitles = maskEnglishTemporalLiterals(content);
  const occurrenceExpression = parseEnglishTemporalExpressions(maskedTitles)[0];
  if (!occurrenceExpression) {
    return undefined;
  }

  const supersededExpressions = "iso" in occurrenceExpression
    ? parseEnglishTemporalExpressions(
      maskedTitles.replace(
        occurrenceExpression.raw,
        " ".repeat(occurrenceExpression.raw.length),
      ),
    )
    : [];
  const canonical = stripEnglishOccurrenceExpressions(
    content,
    maskedTitles,
    [occurrenceExpression, ...supersededExpressions],
  );
  const canonicalize = canResolveOccurrenceExpression({
    ...context,
    expression: occurrenceExpression,
  });

  return COMPLETED_FIRST_PERSON_EVENT_PATTERN.test(canonical)
    ? {
      content: canonicalize ? canonical : content,
      occurrenceExpression,
    }
    : undefined;
}

function cleanPersonalUseTarget(value: string): string {
  return cleanExtractedValue(value)
    .replace(/\s+(?:that|which)\s+i\b.*$/i, "")
    .replace(/\s+and\s+(?:it|they)(?:'s|\s+are|\s+were)\b.*$/i, "")
    .trim();
}

function cleanLearningTopic(value: string): string {
  return cleanExtractedValue(value)
    .replace(/^some\s+/i, "")
    .trim();
}

function extractProjectLeadershipContext(content: string): string | undefined {
  const match = content.match(PROJECT_LEADERSHIP_CONTEXT_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  return cleanExtractedValue(match[1]);
}

function cleanPersonalBestEvent(value: string): string {
  const event = cleanExtractedValue(value)
    .replace(/^another\s+/i, "")
    .replace(/\s+coming up$/i, "")
    .trim();

  return /^(?:a|an)\s+/i.test(event) ? event : `a ${event}`;
}

function normalizeEducationSubject(value: string): string {
  const cleaned = cleanExtractedValue(value)
    .replace(/\s+/g, " ")
    .trim();

  if (/^(?:cs|c\.s\.|computer\s+science)$/i.test(cleaned)) {
    return "Computer Science";
  }

  return cleaned;
}

function cleanRoleValue(value: string): string {
  return cleanExtractedValue(value).replace(/\s+role$/i, "").trim();
}

function cleanLocationValue(value: string): string {
  return cleanExtractedValue(value)
    .split(/\s+(?=working\b|leading\b|based\b|remember\b)/i)[0]!
    .trim();
}

function shouldSkipExplicitFactForProfileLikeClause(
  factContent: string,
  candidates: MemoryCandidate[],
): boolean {
  if (!candidates.some((candidate) => candidate.kindHint === "profile")) {
    return false;
  }

  return !PROFILE_LIKE_PROJECT_FACT_PATTERNS.some((pattern) => pattern.test(factContent));
}

function dedupeCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  return candidates.filter((candidate, candidateIndex, all) => {
    return (
      all.findIndex((other) => {
        return (
          other.kindHint === candidate.kindHint &&
          other.content.toLowerCase() === candidate.content.toLowerCase() &&
          other.metadata?.profileField === candidate.metadata?.profileField &&
          other.metadata?.preferenceCategory === candidate.metadata?.preferenceCategory &&
          other.metadata?.referencePointer === candidate.metadata?.referencePointer
        );
      }) === candidateIndex
    );
  });
}

function maybeExtractCandidatesFromClause(
  content: string,
  index: number,
  nextId: () => string,
  analysis?: LanguageContentAnalysis,
  hasSourceOfTruthReference = false,
  disposition: "fact" | "feedback" | "ordinary" = "ordinary",
  occurrenceContext?: {
    locale: string;
    observedAt?: string;
    timezone?: string;
  },
): MemoryCandidate[] {
  const trimmed = content.trim();

  if (
    trimmed.length === 0 ||
    GREETING_PATTERN.test(trimmed) ||
    REMEMBER_QUESTION_PATTERN.test(trimmed) ||
    (disposition === "ordinary" &&
      (analysis?.interrogative === true ||
        analysis?.behavioralDirective === "one_off"))
  ) {
    return [];
  }

  if (disposition === "feedback") {
    const optOutTarget = extractEnglishOptOutTarget(trimmed);
    return [{
      id: nextId(),
      kindHint: "feedback",
      explicitness: "explicit",
      content: trimmed,
      disposition: createLanguageDurableOptOutDisposition(
        optOutTarget,
        ENGLISH_DURABLE_TARGET_ALIASES,
      ),
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        feedbackKind: "dont",
        appliesTo: "general_response",
      },
    }];
  }

  if (
    disposition === "ordinary" &&
    analysis?.behavioralDirective === "durable"
  ) {
    return [{
      id: nextId(),
      kindHint: "feedback",
      explicitness: "explicit",
      content: trimmed,
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        feedbackKind: deriveFeedbackKind(trimmed, analysis),
        appliesTo: "general_response",
        ...(ENGLISH_CORRECTION_PREAMBLE_PATTERN.test(trimmed)
          ? { attributes: { languageDurableSignal: "procedural_feedback" } }
          : {}),
      },
    }];
  }

  const occurrenceEvent = extractEnglishOccurrenceEvent(
    trimmed,
    occurrenceContext ?? { locale: "en-US" },
  );
  if (occurrenceEvent) {
    return [
      createFactCandidate(
        index,
        nextId,
        occurrenceEvent.content,
        "event",
        { occurrenceExpression: occurrenceEvent.occurrenceExpression },
      ),
    ];
  }
  const maskedTemporalLiterals = maskEnglishTemporalLiterals(trimmed);
  if (
    isEnglishCompletedEventAssertion(trimmed) &&
    COMPLETED_FIRST_PERSON_EVENT_PATTERN.test(trimmed) &&
    parseEnglishTemporalExpressions(trimmed).length > 0 &&
    parseEnglishTemporalExpressions(maskedTemporalLiterals).length === 0
  ) {
    return [createFactCandidate(index, nextId, trimmed, "event")];
  }

  const candidates: MemoryCandidate[] = [];

  const quarterlyPriority = trimmed.match(QUARTERLY_PRIORITY_PATTERN)?.[1];
  if (quarterlyPriority) {
    candidates.push(createFactCandidate(
      index,
      nextId,
      `Quarterly priority: ${cleanExtractedValue(quarterlyPriority)}`,
      undefined,
      { category: "goal", tags: ["life_coach", "goal"] },
    ));
  }

  const currentGoal = trimmed.match(CURRENT_GOAL_PATTERN)?.[1];
  if (currentGoal) {
    candidates.push(createFactCandidate(
      index,
      nextId,
      cleanExtractedValue(currentGoal),
      undefined,
      { category: "goal", tags: ["life_coach", "goal"] },
    ));
  }

  const habit = trimmed.match(HABIT_PATTERN)?.[1];
  if (habit) {
    candidates.push(createFactCandidate(
      index,
      nextId,
      cleanExtractedValue(habit),
      undefined,
      { category: "habit", tags: ["life_coach", "habit"] },
    ));
  }

  const coachingStyle = trimmed.match(COACHING_STYLE_PATTERN)?.[1];
  if (coachingStyle) {
    const preferenceValue = cleanExtractedValue(coachingStyle);
    candidates.push({
      content: preferenceValue,
      explicitness: "explicit",
      id: nextId(),
      kindHint: "preference",
      metadata: {
        preferenceCategory: "coaching_style",
        preferenceValue,
        tags: ["life_coach", "coaching_style"],
      },
      sourceMessageIndex: index,
      sourceRole: "user",
    });
  }

  const positiveFeedback = trimmed.match(POSITIVE_COACHING_FEEDBACK_PATTERN)?.[1];
  if (positiveFeedback) {
    candidates.push({
      content: cleanExtractedValue(positiveFeedback),
      explicitness: "explicit",
      id: nextId(),
      kindHint: "feedback",
      metadata: {
        appliesTo: "life_coach_response",
        feedbackKind: "do",
        tags: ["life_coach", "intervention_feedback"],
      },
      sourceMessageIndex: index,
      sourceRole: "user",
    });
  }

  const nameMatch = trimmed.match(PROFILE_NAME_PATTERN);
  const name = nameMatch ? cleanExtractedValue(nameMatch[1]!) : undefined;
  if (name) {
    candidates.push(createProfileCandidate(index, nextId, "name", name));
  }

  const roleWithOrganizationAndLocationMatch = trimmed.match(
    PROFILE_ROLE_WITH_ORGANIZATION_AND_LOCATION_PATTERN,
  );
  const roleDriftWithProjectMatch = trimmed.match(
    PROFILE_ROLE_DRIFT_WITH_PROJECT_PATTERN,
  );
  if (roleDriftWithProjectMatch) {
    const role = cleanRoleValue(roleDriftWithProjectMatch[1]!);
    const project = cleanExtractedValue(roleDriftWithProjectMatch[2]!);
    candidates.push(
      createProfileCandidate(
        index,
        nextId,
        "role",
        role,
      ),
    );
    candidates.push(
      createProfileCandidate(
        index,
        nextId,
        "currentProject",
        project,
      ),
    );
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `my current role is ${role} leading ${project}.`,
        "project",
      ),
    );
  } else if (roleWithOrganizationAndLocationMatch) {
    candidates.push(
      createProfileCandidate(
        index,
        nextId,
        "role",
        cleanRoleValue(roleWithOrganizationAndLocationMatch[1]!),
      ),
    );
    candidates.push(
      createProfileCandidate(
        index,
        nextId,
        "organization",
        cleanExtractedValue(roleWithOrganizationAndLocationMatch[2]!),
      ),
    );
    candidates.push(
      createProfileCandidate(
        index,
        nextId,
        "location",
        cleanLocationValue(roleWithOrganizationAndLocationMatch[3]!),
      ),
    );
  } else {
    const roleWithOrganizationMatch = trimmed.match(PROFILE_ROLE_WITH_ORGANIZATION_PATTERN);
    if (roleWithOrganizationMatch) {
      candidates.push(
        createProfileCandidate(
          index,
          nextId,
          "role",
          cleanRoleValue(roleWithOrganizationMatch[1]!),
        ),
      );
      candidates.push(
        createProfileCandidate(
          index,
          nextId,
          "organization",
          cleanExtractedValue(roleWithOrganizationMatch[2]!),
        ),
      );
    } else {
      const roleWithLocationMatch = trimmed.match(PROFILE_ROLE_WITH_LOCATION_PATTERN);
      if (roleWithLocationMatch) {
        candidates.push(
          createProfileCandidate(
            index,
            nextId,
            "role",
            cleanRoleValue(roleWithLocationMatch[1]!),
          ),
        );
        candidates.push(
          createProfileCandidate(
            index,
            nextId,
            "location",
            cleanLocationValue(roleWithLocationMatch[2]!),
          ),
        );
      } else {
        const roleMatch = trimmed.match(PROFILE_ROLE_PATTERN);
        const role = roleMatch ? cleanRoleValue(roleMatch[1]!) : undefined;
        if (role) {
          candidates.push(createProfileCandidate(index, nextId, "role", role));
        }

        const locationMatch = trimmed.match(PROFILE_LOCATION_PATTERN);
        const location = locationMatch
          ? cleanLocationValue(locationMatch[1]!)
          : undefined;
        if (location) {
          candidates.push(createProfileCandidate(index, nextId, "location", location));
        }
      }
    }
  }

  const timezoneMatch = trimmed.match(PROFILE_TIMEZONE_PATTERN);
  const timezone = timezoneMatch
    ? cleanExtractedValue(timezoneMatch[1]!)
    : undefined;
  if (timezone) {
    candidates.push(createProfileCandidate(index, nextId, "timezone", timezone));
  }

  const languageMatch = trimmed.match(PROFILE_LANGUAGE_PATTERN);
  const languagePreference = languageMatch
    ? cleanExtractedValue(languageMatch[1]!)
    : undefined;
  if (languagePreference) {
    candidates.push(
      createProfileCandidate(
        index,
        nextId,
        "languagePreference",
        languagePreference,
      ),
    );
  }

  const currentProjectMatch = trimmed.match(CURRENT_PROJECT_PATTERN);
  const currentProject = currentProjectMatch
    ? cleanExtractedValue(currentProjectMatch[1]!)
    : undefined;
  if (currentProject) {
    candidates.push(
      createProfileCandidate(index, nextId, "currentProject", currentProject),
    );
  }

  const educationDegreeMatch = trimmed.match(EDUCATION_DEGREE_PATTERN);
  const educationDegree = educationDegreeMatch
    ? cleanExtractedValue(educationDegreeMatch[1]!)
    : undefined;
  if (educationDegree) {
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I graduated with a degree in ${educationDegree}.`,
        "personal",
      ),
    );
  }

  const petNameMatch = trimmed.match(PET_NAME_PATTERN);
  if (petNameMatch) {
    const pet = cleanExtractedValue(petNameMatch[1]!).toLowerCase();
    const name = cleanExtractedValue(petNameMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `My ${pet}'s name is ${name}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: `${pet} name`,
        },
      ),
    );
  }

  const petBreedLikeMatch = trimmed.match(PET_BREED_LIKE_PATTERN);
  if (
    petBreedLikeMatch &&
    /\b(?:dog|puppy|collar|leash|walker|pet)\b/i.test(trimmed)
  ) {
    const breed = cleanExtractedValue(petBreedLikeMatch[1]!);
    const name = cleanExtractedValue(petBreedLikeMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `My dog ${name} is a ${breed}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: "dog breed",
        },
      ),
    );
  }

  const petBreedAssertionMatch = trimmed.match(PET_BREED_ASSERTION_PATTERN);
  if (petBreedAssertionMatch) {
    const name = cleanExtractedValue(petBreedAssertionMatch[1]!);
    const breed = cleanExtractedValue(petBreedAssertionMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `My dog ${name} is a ${breed}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: "dog breed",
        },
      ),
    );
  }

  const undergradInstitutionMatch = trimmed.match(UNDERGRAD_INSTITUTION_PATTERN);
  if (undergradInstitutionMatch) {
    const subject = normalizeEducationSubject(undergradInstitutionMatch[1]!);
    const institution = cleanExtractedValue(undergradInstitutionMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I completed my undergraduate ${subject} degree at ${institution}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: `undergraduate ${subject.toLowerCase()} degree`,
        },
      ),
    );
  }

  const firstPersonUseMatch = trimmed.match(FIRST_PERSON_USE_PATTERN);
  if (firstPersonUseMatch) {
    const target = cleanPersonalUseTarget(firstPersonUseMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I use ${target}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: extractBoundedEnglishSubject(target) ?? "personal use",
        },
      ),
    );
  }

  const personalAttributeMatch = trimmed.match(PERSONAL_ATTRIBUTE_PATTERN);
  if (personalAttributeMatch) {
    const subject = cleanExtractedValue(personalAttributeMatch[1]!);
    const value = cleanExtractedValue(personalAttributeMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `My ${subject} takes ${value}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: extractBoundedEnglishSubject(subject) ?? subject,
        },
      ),
    );
  }

  const openLoopMatch = trimmed.match(OPEN_LOOP_PATTERN);
  if (openLoopMatch) {
    const task = cleanEventObject(openLoopMatch[2]!);
    const content = `I ${openLoopMatch[1] ? "still " : ""}need to ${task}.`;
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        content,
        "personal",
        {
          category: "personal",
          factKind: "open_loop",
          scopeKind: "identity",
          subject: extractBoundedEnglishSubject(task) ?? "open loop",
        },
      ),
    );
  }

  const plannedOpenLoopMatch = trimmed.match(PLANNED_OPEN_LOOP_PATTERN);
  if (plannedOpenLoopMatch) {
    const task = cleanEventObject(plannedOpenLoopMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I still need to ${task}.`,
        "personal",
        {
          category: "personal",
          factKind: "open_loop",
          scopeKind: "identity",
          subject: extractBoundedEnglishSubject(task) ?? "open loop",
        },
      ),
    );
  }

  const projectActivityMatch = trimmed.match(PROJECT_ACTIVITY_PATTERN);
  const recentEventMatch = trimmed.match(RECENT_EVENT_PATTERN);
  if (recentEventMatch && !projectActivityMatch) {
    const action = recentEventMatch[1]!.toLowerCase();
    const target = cleanEventObject(recentEventMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I ${action} ${target}.`,
        "event",
      ),
    );
  }

  if (trimmed.match(PERSONAL_BEST_TIME_PATTERN)) {
    const personalBestTimeMatch = trimmed.match(PERSONAL_BEST_TIME_PATTERN)!;
    const event = personalBestTimeMatch[1]
      ? cleanPersonalBestEvent(personalBestTimeMatch[1]!)
      : "";
    const time = cleanExtractedValue(personalBestTimeMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `My personal best time${event ? ` in ${event}` : ""} is ${time}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: event ? extractBoundedEnglishSubject(event) : "personal best time",
        },
      ),
    );
  }

  const learningWithToolMatch = trimmed.match(LEARNING_WITH_TOOL_PATTERN);
  if (learningWithToolMatch) {
    const topic = cleanLearningTopic(learningWithToolMatch[1]!);
    const tool = cleanExtractedValue(learningWithToolMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I use ${tool} for ${topic}.`,
        "personal",
      ),
    );
  }

  const userIdentityMatch = trimmed.match(USER_IDENTITY_PATTERN);
  if (userIdentityMatch) {
    const identity = cleanExtractedValue(userIdentityMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I am a ${identity} user.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: extractBoundedEnglishSubject(identity) ?? identity,
        },
      ),
    );
  }

  const currentProjectInvolvementMatch = trimmed.match(
    CURRENT_PROJECT_INVOLVEMENT_PATTERN,
  );
  if (currentProjectInvolvementMatch) {
    const project = cleanExtractedValue(currentProjectInvolvementMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I am working on ${project}.`,
        "project",
        {
          category: "project",
          factKind: "generic_project",
          scopeKind: "project",
          subject: extractBoundedEnglishSubject(project) ?? "project",
        },
      ),
    );
  }

  const projectLeadershipMatch = trimmed.match(PROJECT_LEADERSHIP_PATTERN);
  if (projectLeadershipMatch) {
    const leadership = cleanExtractedValue(projectLeadershipMatch[1]!);
    const projectContext = extractProjectLeadershipContext(trimmed);
    const content = projectContext
      ? `I led ${leadership} for my ${projectContext}.`
      : `I led ${leadership}.`;
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        content,
        "project",
        {
          category: "project",
          factKind: "generic_project",
          scopeKind: "project",
          subject:
            extractBoundedEnglishSubject(projectContext ?? leadership) ?? "project",
        },
      ),
    );
  }

  if (projectActivityMatch) {
    const action = projectActivityMatch[1]!.toLowerCase();
    const activity = cleanExtractedValue(projectActivityMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I ${action} ${activity}.`,
        "project",
        {
          category: "project",
          factKind: "generic_project",
          scopeKind: "project",
          subject: extractBoundedEnglishSubject(activity) ?? "project activity",
        },
      ),
    );
  }

  const relationRelocationMatch =
    trimmed.match(RELATION_RELOCATION_WHO_PATTERN) ??
    trimmed.match(RELATION_RELOCATION_DIRECT_PATTERN);
  if (relationRelocationMatch) {
    const name = cleanExtractedValue(relationRelocationMatch[1]!);
    const back = relationRelocationMatch[2] ? " back" : "";
    const location = cleanExtractedValue(relationRelocationMatch[3]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `${name} moved${back} to ${location}.`,
        "relationship",
        {
          attributes: { claimKey: "relationship.location" },
          category: "relationship",
          scopeKind: "identity",
          subject: name,
        },
      ),
    );
  }

  if (EXPLICIT_DECISION_PATTERN.test(trimmed)) {
    candidates.push(
      createFactCandidate(index, nextId, trimmed, "project", {
        attributes: { languageDurableSignal: "confirmed_decision" },
      }),
    );
  }

  if (isExplicitProjectPolicyDecision(trimmed)) {
    candidates.push(
      createFactCandidate(index, nextId, trimmed, "project", {
        attributes: { languageDurableSignal: "confirmed_decision" },
      }),
    );
  }

  const followUpOpenLoopMatch = trimmed.match(FOLLOW_UP_OPEN_LOOP_PATTERN);
  const openLoop = followUpOpenLoopMatch
    ? cleanExtractedValue(followUpOpenLoopMatch[1]!)
    : undefined;
  if (openLoop) {
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `the open loop is ${openLoop}.`,
      ),
    );
  }

  const preferenceMatch = trimmed.match(PREFERENCE_PATTERN);
  if (preferenceMatch) {
    const preferenceValue = preferenceMatch[1]!.trim();

    candidates.push({
      id: nextId(),
      kindHint: "preference",
      explicitness: "explicit",
      content: preferenceValue,
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        preferenceCategory: "response_style",
        preferenceValue,
      },
    });
  }

  const explicitFactContent = disposition === "fact"
    ? cleanExplicitFactContent(trimmed)
    : undefined;
  const extractedReferencePointer = TECHNICAL_REFERENCE_DIRECTIVE_PATTERN.test(
      trimmed,
    )
    ? extractReferencePointer(trimmed)
    : undefined;
  const technicalReferencePointer = extractedReferencePointer &&
      !/^(?:e\.g|i\.e)$/iu.test(extractedReferencePointer)
    ? extractedReferencePointer
    : undefined;
  if (
    explicitFactContent &&
    !preferenceMatch &&
    !technicalReferencePointer &&
    !candidates.some(({ kindHint }) => kindHint === "fact") &&
    !shouldSkipExplicitFactForProfileLikeClause(explicitFactContent, candidates)
  ) {
    candidates.push(createFactCandidate(index, nextId, explicitFactContent));
  }

  if (!hasSourceOfTruthReference && technicalReferencePointer) {
    const pointer = technicalReferencePointer;
    candidates.push({
      id: nextId(),
      kindHint: "reference",
      explicitness: "explicit",
      content: pointer,
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        referenceKind: deriveReferenceKind(trimmed, pointer),
        referenceTitle: pointer.split("/").at(-1) ?? pointer,
        referencePointer: pointer,
        subject: extractReferenceSubject(trimmed) ?? "unknown",
      },
    });
  }

  if (candidates.length === 0 && trimmed.length >= 24 && looksLikeDurableInferredFact(trimmed)) {
    candidates.push({
      id: nextId(),
      kindHint: "fact",
      explicitness: "inferred",
      content: trimmed,
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        ...buildFactMetadata(trimmed),
      },
    });
  }

  return dedupeCandidates(candidates);
}

export function createEnglishLanguagePack(): LanguagePack {
  return {
    analyzerVersion: "19-reported-directive-scope",
    apiVersion: 1,
    compatibilityGroup: "en",
    defaultLocale: "en-US",
    id: "en",
    locales: ["en"],
    detect({ texts }) {
      return /\p{Script=Latin}/u.test(texts.join(" "))
        ? "compatible"
        : "none";
    },
    splitClauses(text: string): string[] {
      return splitEnglishClauses(text);
    },
    normalizeForEquality(text: string): string {
      return normalizeUnicodeForEquality(text);
    },
    splitSentences(text: string): string[] {
      return splitSentencesGeneric(text);
    },
    tokenizeForScoring(
      text: string,
      mode: "bm25" | "overlap",
      options?: { excludeStopwords?: boolean },
    ): string[] {
      const minTokenLength = mode === "overlap" ? 4 : 2;
      const tokens = tokenizeUnicodeText(text, "en-US").filter(
        (token) => token.length >= minTokenLength,
      );
      if (options?.excludeStopwords) {
        return filterEnglishRetrievalTokens(text, minTokenLength);
      }
      return tokens;
    },
    buildSearchTerms(text: string): string[] {
      return filterEnglishRetrievalTokens(text, 2, true);
    },
    decomposeQuery: decomposeEnglishQuery,
    analyzeBehavioralRule(text) {
      return analyzeEnglishBehavioralRule(text, BEHAVIORAL_RULE_PATTERNS);
    },
    analyzeQuery: analyzeEnglishQuery,
    analyzeContent: analyzeEnglishContent,
    parseTemporalExpressions: parseEnglishTemporalExpressions,
    matchesEventPredicate: matchesEnglishEventPredicate,
    extractEntityMentions: extractEnglishEntityMentions,
    matchesEntityAlias(query, alias) {
      return matchesNormalizedEntityAlias(
        query,
        alias,
        normalizeUnicodeForEquality,
      );
    },
    acceptsEntityCandidate: acceptsEnglishEntityCandidate,
    deriveDurableTarget(candidate) {
      return deriveEnglishDurableTarget(candidate);
    },
    render: renderEnglish,
    extractCandidates(input: LanguageCandidateExtractionInput): MemoryCandidate[] {
      const candidates: MemoryCandidate[] = [];

      input.messages.forEach((message, index) => {
        if (message.role !== "user") {
          return;
        }

        const sourceMessageIndex = message.sourceMessageIndex ?? index;
        const canonicalSourceAnalysis = analyzeEnglishContent(message.content);
        const sourceAnalysis = {
          ...(message.analysis ?? canonicalSourceAnalysis),
          behavioralDirective: canonicalSourceAnalysis.behavioralDirective,
          interrogative: canonicalSourceAnalysis.interrogative,
        };
        const clauses = expandExplicitFactCandidateClauses(
          message.content,
          extractExplicitFactClauses,
          splitEnglishClauses,
        );
        for (const clause of clauses) {
          const clauseAnalysis = clauses.length === 1 && clause.content === message.content
            ? sourceAnalysis
            : analyzeEnglishContent(clause.content);
          if (
            clause.disposition === "ordinary" &&
            (clauseAnalysis.interrogative === true ||
              clauseAnalysis.behavioralDirective === "one_off")
          ) {
            continue;
          }
          const sourceOfTruthReference = clause.disposition === "feedback"
            ? undefined
            : createSourceOfTruthReferenceCandidate({
              analysis: clauseAnalysis,
              nextId: input.nextId,
              sourceMessageIndex,
              subject: extractReferenceSubject(clause.content) ?? "unknown",
            });
          if (sourceOfTruthReference) {
            candidates.push(sourceOfTruthReference);
          }
          candidates.push(
            ...maybeExtractCandidatesFromClause(
              clause.content,
              sourceMessageIndex,
              input.nextId,
              clauseAnalysis,
              Boolean(sourceOfTruthReference),
              clause.disposition,
              {
                locale: input.locale,
                observedAt: message.observedAt,
                timezone: message.timezone,
              },
            ),
          );
        }
      });

      return dedupeCandidates(candidates).map(attachEnglishDurableTarget);
    },
  };
}
