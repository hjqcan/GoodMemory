import type {
  MemoryCandidate,
  MemoryCandidateMetadata,
  ProfileField,
} from "../domain/memoryCandidate";
import type {
  LanguageCandidateExtractionInput,
  LanguagePack,
} from "./contracts";
import type {
  FactKind,
  MemoryScopeKind,
  ReferenceKind,
} from "../domain/records";
import {
  splitClausesGeneric,
  normalizeUnicodeForEquality,
  tokenizeUnicodeText,
} from "./generic";
import {
  acceptsEnglishEntityCandidate,
  analyzeEnglishContent,
  analyzeEnglishQuery,
  decomposeEnglishQuery,
  extractEnglishEntityMentions,
  parseEnglishTemporalExpressions,
  renderEnglish,
} from "./englishSemantics";
import { resolveEnglishTemporalReference } from "./englishTemporal";
import {
  matchesNormalizedEntityAlias,
  splitSentencesGeneric,
} from "./packHelpers";

const GREETING_PATTERN = /^(hi|hello|hey|thanks|thank you|ok|okay)[.!]?$/i;
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
const EDUCATION_DEGREE_PATTERN =
  /\bi\s+(?:graduated|earned|have|hold)\s+(?:with\s+)?(?:a\s+)?degree\s+in\s+([^,.!?]+)(?=[,.!?]|$)/i;
const PET_NAME_PATTERN =
  /\bmy\s+(cat|dog|puppy|kitten|pet)(?:['’]s)?\s+name\s+is\s+([A-Z][A-Za-z'’-]{1,40})(?=\s*(?:[,.;!?]|\band\b|$))/i;
const PET_BREED_LIKE_PATTERN =
  /\b(?:suit|for)\s+(?:an?\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s+like\s+([A-Z][A-Za-z'’-]{1,40})\b/i;
const UNDERGRAD_INSTITUTION_PATTERN =
  /\bi\s+completed\s+my\s+(?:undergrad|undergraduate(?:\s+degree)?|bachelor['’]?s(?:\s+degree)?)\s+in\s+([^,.!?]+?)\s+from\s+([A-Z][A-Za-z0-9&.' -]{1,80}?)(?=\s*(?:[,.;!?]|\bwhich\b|$))/i;
const STORE_PRODUCT_USE_PATTERN =
  /\bi(?:'ve| have)?\s+(?:been\s+)?using\s+(?:an?\s+)?([^,.!?]{3,80}?\bshampoo)\b[\s\S]{0,120}?\bat\s+([A-Z][A-Za-z0-9&.' -]{1,80}?)(?=\s*(?:[,.;!?]|$))/i;
const DAILY_COMMUTE_DURATION_PATTERN =
  /\bmy daily commute\b[^.!?]*\btakes\s+([^,.!?]+)(?=[,.!?]|$)/i;
const STORE_APP_PATTERN =
  /\busing the\s+(.+?)\s+app\s+from\s+([A-Z][A-Za-z0-9&.' -]*?)(?=\s+and\b|[,.!?]|$)/i;
const COUPON_REDEMPTION_PATTERN =
  /\bi\s+(?:actually\s+)?redeemed\s+(a\s+)?(\$?\d+\s+coupon\s+on\s+[^,.!?]+?)(\s+last\s+\w+)?(?=[,.!?]|$)/i;
const PENDING_PICKUP_OR_RETURN_PATTERN =
  /\bi\s+(?:still\s+)?need\s+to\s+(pick up|return)\s+(?!or\b)([^.!?]+?)(?=[.!?]|$)/i;
const DIRECT_PICKUP_TASK_PATTERN =
  /\bi(?:'ll| will)\s+(?:take a break and\s+)?pick up\s+([^.!?]+?)(?=[.!?]|$)/i;
const RECENT_PERSONAL_EVENT_PATTERN =
  /\bi\s+just\s+(helped|ordered)\s+([^,.!?]+?)(?:\s+today)?(?=[,.!?]|$)/i;
const PERSONAL_BEST_TIME_PATTERN =
  /\bpersonal best time(?:\s+in\s+(.+?))?\s+(?:with a time of|of)\s+([0-9]{1,2}:[0-9]{2}|[0-9]+\s+minutes?(?:\s+and\s+[0-9]+\s+seconds?)?)(?=\s|[,.!?]|$)/i;
const PERSONAL_BEST_CONTEXT_TIME_PATTERN =
  /\b((?:charity\s+)?5k\s+run|marathon|race)\b[\s\S]{0,240}?\bpersonal best time\s+of\s+([0-9]{1,2}:[0-9]{2}|[0-9]+\s+minutes?(?:\s+and\s+[0-9]+\s+seconds?)?)(?=\s|[,.!?]|$)/i;
const TOOL_LEARNING_INTEREST_PATTERN =
  /\bi(?:'m| am)\s+trying\s+to\s+learn\s+more\s+about\s+(.+?)\s+with\s+(.+?),\s+which\s+i\s+enjoy\s+to\s+use\b/i;
const MODEL_KIT_TARGET_PATTERN =
  /\b(?:model kit|kit|\d+\/\d+\s+scale)\b/i;
const MODEL_KIT_FINISHED_PATTERN =
  /\bi\s+recently\s+finished\s+(?:a\s+)?(.+?(?:\bmodel kit\b|\bkit\b|\b\d+\/\d+\s+scale\b).*?)(?=\s+that\b|\s+and\b|[!?]|$)/i;
const MODEL_KIT_NEW_PATTERN =
  /\b(?:my|the|a)\s+new\s+([^,.!?]*?(?:\bmodel kit\b|\bkit\b|\b\d+\/\d+\s+scale\b)[^,.!?]*?)(?=\s+and\b|[,.!?]|$)/i;
const MODEL_KIT_GOT_ADDITIONAL_PATTERN =
  /\bi\s+just\s+got\s+(?:this\s+kit|[^,.!?]*?(?:\bmodel kit\b|\bkit\b|\b\d+\/\d+\s+scale\b)[^,.!?]*?)\s+and\s+(?:a\s+)?([^,.!?]*?(?:\bmodel kit\b|\bkit\b|\b\d+\/\d+\s+scale\b)[^,.!?]*?)(?=\s+at\b|\s+from\b|[,.!?]|$)/i;
const MODEL_KIT_WORKING_ON_PATTERN =
  /\b(?:i(?:'m| am)|i(?:\s+also)?)\s+(?:started\s+)?working\s+on\s+(?:a\s+diorama\s+featuring\s+)?(?:a\s+)?([^,.!?]*?(?:\bmodel kit\b|\bkit\b|\b\d+\/\d+\s+scale\b)[^,.!?]*?)(?=\s+next\b|[,.!?]|$)/i;
const KOREAN_RESTAURANT_COUNT_PATTERN =
  /\bkorean restaurants?\b[\s\S]*?\bi(?:'ve| have)\s+tried\s+([^,.!?]+?)\s+(?:different\s+)?(?:ones|restaurants?)\b/i;
const CURRENT_PROJECT_INVOLVEMENT_PATTERN =
  /\bi(?:'m| am|(?:'ve| have)\s+been)\s+working\s+on\s+(a\s+(?:solo\s+)?project[^,.!?]*?)(?=[,.!?]|$)/i;
const PROJECT_LEADERSHIP_PATTERN =
  /\bi\s+led\s+([^,.!?]+?)(?=\s+and\b|[,.!?]|$)/i;
const PROJECT_LEADERSHIP_CONTEXT_PATTERN =
  /\b(?:in|from)\s+my\s+([^,.!?]*?\bproject\b[^,.!?]*?)[,.]?\s+(?:where\s+)?i\s+led\b/i;
const CASE_COMPETITION_ACTIVITY_PATTERN =
  /\bi\s+recently\s+participated\s+in\s+(a\s+case competition[^,.!?]*?)(?=[,.!?]|$)/i;
const RESEARCH_PROJECT_PATTERN =
  /\bi\s+recently\s+presented\s+a\s+poster\s+on\s+my\s+research\s+on\s+([^,.!?]+?)(?=\s+at\b|[,.!?]|$)/i;
const RELATION_RELOCATION_WHO_PATTERN =
  /\bmy\s+(?:friend|cousin|aunt|uncle|sister|brother|partner|colleague)\s+([A-Z][A-Za-z'-]+)\s+who\s+(?:recently\s+|just\s+)?moved\s+(back\s+)?to\s+([^,.!?]+?)(?=[,.!?]|$)/i;
const RELATION_RELOCATION_DIRECT_PATTERN =
  /\bmy\s+(?:friend|cousin|aunt|uncle|sister|brother|partner|colleague)\s+([A-Z][A-Za-z'-]+)\s+(?:actually\s+)?(?:recently\s+|just\s+)?moved\s+(back\s+)?to\s+([^,.!?]+?)(?=[,.!?]|$)/i;
const PHOTOGRAPHY_COMPATIBLE_EQUIPMENT_PATTERN =
  /\bcompatible with my\s+([^,.!?]+?)(?=[,.!?]|$)/i;
const PHOTOGRAPHY_LENS_EQUIPMENT_PATTERN =
  /\bmy\s+([A-Za-z0-9 /.+-]*?\blens)\b/i;
const SONY_CAMERA_USER_PATTERN = /\bas a sony camera user\b/i;
const PROFESSIONAL_FIELD_PATTERN =
  /\bthis field of\s+([^?!.]+?)[?!.]\s*skip the basics as i am working in the field\b/i;
const RESEARCH_ARTICLE_INTEREST_PATTERN =
  /\bi(?:'d| would)\s+like\s+to\s+explore\s+some\s+more\s+research papers and articles\s+on\s+(?:the\s+topic\s+of\s+)?([^,.!?]+?)(?=[,.!?]|$)/i;
const EXPLICIT_FACT_PATTERN = /remember (?:that|this)\s+(.+)/i;
const EXPLICIT_DECISION_PATTERN =
  /\b(?:we decided|canonical source of truth|must remain)\b/i;
const FOLLOW_UP_OPEN_LOOP_PATTERN =
  /\bstill\s+have\s+an?\s+open\s+loop\s+on\s+(.+?)(?=\.|$)/i;
const PREFERENCE_PATTERN = /i prefer\s+(.+?)(?:\.|$)/i;
const REFERENCE_PATTERN =
  /use\s+([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\s+as the source of truth/i;
const CORRECTED_REFERENCE_PATTERN =
  /(?:correction:\s*)?([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\s+is now the source of truth,\s*not\s+([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/i;
const CORRECTIVE_FEEDBACK_PATTERN =
  /\b(?:correction|wrong|not right|instead|next time|from now on|that approach was wrong)\b/i;
const PROCEDURAL_FEEDBACK_PATTERN =
  /^(?:always|never|don't|do not|prefer|remember to)\b|^please\s+(?:keep|make|give|use|avoid|prioritize|format|structure|focus|be|continue|answer|reply)\b/i;
const NEVER_MIND_PATTERN = /^never mind\b/i;
const ONE_OFF_POLITE_REQUEST_PATTERN =
  /^(?:could|can|would)\s+you\s+please\b/i;
const ROLEPLAY_RESPONSE_REQUEST_PATTERN =
  /^please\s+respond\s+as\s+(?:the\s+)?user\b/i;
const PROJECT_POLICY_ACTION_PATTERN =
  /\b(?:must|shall|uses?|forbids?|allows?|defaults?|represents?|wraps?|leaves?|keeps?|routes?|rejects?|stores?|retains?|removes?|runs?|writes?|reads?|treats?|maps?|converts?|passes?\s+through)\b/iu;
const PROJECT_POLICY_DECLARATION_PATTERN =
  /\b(?:the\s+)?(?:project|repository|repo)\s+policy\s*(?:(:|=)\s*([^\n]+)|mandates?\s+that\s+([^\n]+)|is\s+that\s+([^\n]+)|is\s+to\s+([^\n]+))/iu;
const TECHNICAL_REFERENCE_PATTERN =
  /(~\/\.goodmemory(?:\/[A-Za-z0-9_./-]+)?|\.goodmemory\/[A-Za-z0-9_./-]*|(?:docs|task-board|reports|scripts|src|tests)\/[A-Za-z0-9_./-]*|(?:README|AGENTS|CLAUDE)\.md)/u;
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
  "how",
  "if",
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
  "who",
  "why",
  "you",
]);
const ENGLISH_SUBJECT_TAIL_PATTERN =
  /\b(?:and|but)\s+(?:driving|tracking|keeping|handling|reviewing|planning|shipping|rolling|migrating|preparing|finalizing|waiting|coordinating|owning)\b.*$/i;
const ENGLISH_SUBJECT_CLAUSE_PATTERN =
  /\b(?:while|because|after|before|when|if)\b.*$/i;
const ENGLISH_SUBJECT_PREDICATE_BOUNDARY_PATTERN =
  /\s+(?:is|are|was|were|remains?|stays?|needs?|requires?|has|have)\b/gi;

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

function deriveFeedbackKind(content: string): "do" | "dont" | "prefer" {
  const kind = analyzeEnglishContent(content).feedbackKind;
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
    .trim();
}

function cleanLearningTopic(value: string): string {
  return cleanExtractedValue(value)
    .replace(/^some\s+/i, "")
    .trim();
}

function cleanModelKitTarget(value: string): string {
  return cleanExtractedValue(value)
    .replace(/\s+next$/i, "")
    .replace(/\s+as well$/i, "")
    .trim();
}

function extractProjectLeadershipContext(content: string): string | undefined {
  const match = content.match(PROJECT_LEADERSHIP_CONTEXT_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  return cleanExtractedValue(match[1]);
}

function cleanEquipmentTarget(value: string): string {
  return cleanExtractedValue(value)
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
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

function cleanStoreProductDescription(value: string): string {
  return cleanExtractedValue(value)
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePhotographyEquipment(value: string): boolean {
  return /\b(?:sony|canon|nikon|fujifilm|fuji|panasonic|olympus|leica|camera|lens|a7r|a7|z6|r5|x-t\d+|24-70mm|f\/\d)/i.test(
    value,
  );
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

function looksLikeProceduralFeedback(content: string): boolean {
  return (
    PROCEDURAL_FEEDBACK_PATTERN.test(content) &&
    !NEVER_MIND_PATTERN.test(content) &&
    !ONE_OFF_POLITE_REQUEST_PATTERN.test(content) &&
    !ROLEPLAY_RESPONSE_REQUEST_PATTERN.test(content)
  );
}

function resolveUniqueStoreNameFromMessages(
  messages: LanguageCandidateExtractionInput["messages"],
): string | undefined {
  const stores = new Set<string>();

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const storeAppMatch = message.content.match(STORE_APP_PATTERN);
    if (storeAppMatch?.[2]) {
      stores.add(cleanExtractedValue(storeAppMatch[2]!));
    }
  }

  return stores.size === 1 ? [...stores][0] : undefined;
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
  context?: {
    storeName?: string;
  },
): MemoryCandidate[] {
  const trimmed = content.trim();

  if (trimmed.length === 0 || GREETING_PATTERN.test(trimmed)) {
    return [];
  }

  const candidates: MemoryCandidate[] = [];

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

  const storeProductUseMatch = trimmed.match(STORE_PRODUCT_USE_PATTERN);
  if (storeProductUseMatch) {
    const product = cleanStoreProductDescription(storeProductUseMatch[1]!);
    const store = cleanExtractedValue(storeProductUseMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I use ${store} ${product}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: product,
        },
      ),
    );
  }

  const commuteDurationMatch = trimmed.match(DAILY_COMMUTE_DURATION_PATTERN);
  const commuteDuration = commuteDurationMatch
    ? cleanExtractedValue(commuteDurationMatch[1]!)
    : undefined;
  if (commuteDuration) {
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `My daily commute takes ${commuteDuration}.`,
        "personal",
      ),
    );
  }

  const storeAppMatch = trimmed.match(STORE_APP_PATTERN);
  if (storeAppMatch) {
    const appName = cleanExtractedValue(storeAppMatch[1]!);
    const storeName = cleanExtractedValue(storeAppMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I use the ${appName} app from ${storeName}.`,
        "personal",
      ),
    );
  }

  const couponRedemptionMatch = trimmed.match(COUPON_REDEMPTION_PATTERN);
  if (couponRedemptionMatch) {
    const article = couponRedemptionMatch[1] ?? "";
    const coupon = cleanExtractedValue(couponRedemptionMatch[2]!);
    const date = couponRedemptionMatch[3]
      ? cleanExtractedValue(couponRedemptionMatch[3]!)
      : "";
    const store = context?.storeName ? ` at ${context.storeName}` : "";
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I redeemed ${article}${coupon}${date ? ` ${date}` : ""}${store}.`,
        "event",
      ),
    );
  }

  const pendingPickupOrReturnMatch = trimmed.match(PENDING_PICKUP_OR_RETURN_PATTERN);
  if (pendingPickupOrReturnMatch) {
    const action = pendingPickupOrReturnMatch[1]!.toLowerCase();
    const target = cleanEventObject(pendingPickupOrReturnMatch[2]!);
    const content =
      action === "pick up"
        ? `I still need to pick up ${target}.`
        : `I need to return ${target}.`;
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
          subject: extractBoundedEnglishSubject(target) ?? "unknown",
        },
      ),
    );
  }

  const directPickupTaskMatch = trimmed.match(DIRECT_PICKUP_TASK_PATTERN);
  if (directPickupTaskMatch) {
    const target = cleanEventObject(directPickupTaskMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I still need to pick up ${target}.`,
        "personal",
        {
          category: "personal",
          factKind: "open_loop",
          scopeKind: "identity",
          subject: extractBoundedEnglishSubject(target) ?? "unknown",
        },
      ),
    );
  }

  const recentPersonalEventMatch = trimmed.match(RECENT_PERSONAL_EVENT_PATTERN);
  if (recentPersonalEventMatch) {
    const action = recentPersonalEventMatch[1]!.toLowerCase();
    const target = cleanEventObject(recentPersonalEventMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I ${action} ${target}.`,
        "event",
      ),
    );
  }

  const personalBestContextTimeMatch = trimmed.match(
    PERSONAL_BEST_CONTEXT_TIME_PATTERN,
  );
  if (personalBestContextTimeMatch) {
    const event = cleanPersonalBestEvent(personalBestContextTimeMatch[1]!);
    const time = cleanExtractedValue(personalBestContextTimeMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `My personal best time in ${event} is ${time}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: extractBoundedEnglishSubject(event) ?? "personal best time",
        },
      ),
    );
  } else if (trimmed.match(PERSONAL_BEST_TIME_PATTERN)) {
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

  const toolLearningInterestMatch = trimmed.match(TOOL_LEARNING_INTEREST_PATTERN);
  if (toolLearningInterestMatch) {
    const topic = cleanLearningTopic(toolLearningInterestMatch[1]!);
    const tool = cleanExtractedValue(toolLearningInterestMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I use ${tool} for ${topic}.`,
        "personal",
      ),
    );
  }

  const photographyEquipmentTargets = [
    trimmed.match(PHOTOGRAPHY_COMPATIBLE_EQUIPMENT_PATTERN)?.[1],
    trimmed.match(PHOTOGRAPHY_LENS_EQUIPMENT_PATTERN)?.[1],
  ]
    .filter((target): target is string => typeof target === "string")
    .map(cleanEquipmentTarget)
    .filter(looksLikePhotographyEquipment);
  for (const target of [...new Set(photographyEquipmentTargets)]) {
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `My current photography setup includes ${target}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: "photography setup",
        },
      ),
    );
  }

  if (SONY_CAMERA_USER_PATTERN.test(trimmed)) {
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        "I use Sony cameras.",
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: "photography setup",
        },
      ),
    );
  }

  const researchArticleInterestMatch = trimmed.match(RESEARCH_ARTICLE_INTEREST_PATTERN);
  if (researchArticleInterestMatch) {
    const topic = cleanExtractedValue(researchArticleInterestMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I am interested in ${topic} research papers and articles.`,
        "technical",
        {
          category: "technical",
          scopeKind: "project",
          subject: extractBoundedEnglishSubject(topic) ?? topic,
        },
      ),
    );
  }

  const modelKitTargets = [
    trimmed.match(MODEL_KIT_FINISHED_PATTERN)?.[1],
    trimmed.match(MODEL_KIT_NEW_PATTERN)?.[1],
    trimmed.match(MODEL_KIT_GOT_ADDITIONAL_PATTERN)?.[1],
    trimmed.match(MODEL_KIT_WORKING_ON_PATTERN)?.[1],
  ]
    .filter((target): target is string => typeof target === "string")
    .map(cleanModelKitTarget)
    .filter((target) => MODEL_KIT_TARGET_PATTERN.test(target));
  const uniqueModelKitTargets = [...new Set(modelKitTargets)];
  for (const target of uniqueModelKitTargets) {
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I worked on or got the model kit: ${target}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: extractBoundedEnglishSubject(target) ?? "model kit",
        },
      ),
    );
  }

  const koreanRestaurantCountMatch = trimmed.match(KOREAN_RESTAURANT_COUNT_PATTERN);
  if (koreanRestaurantCountMatch) {
    const count = cleanExtractedValue(koreanRestaurantCountMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I have tried ${count} Korean restaurants in my city.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: "korean restaurants in my city",
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
    if (/\bsolo project\b/i.test(project)) {
      candidates.push(
        createFactCandidate(
          index,
          nextId,
          `I am currently leading ${project}.`,
          "project",
          {
            category: "project",
            factKind: "generic_project",
            scopeKind: "project",
            subject: extractBoundedEnglishSubject(project) ?? "solo project",
            tags: ["current_leadership"],
          },
        ),
      );
    }
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

  const caseCompetitionActivityMatch = trimmed.match(
    CASE_COMPETITION_ACTIVITY_PATTERN,
  );
  if (caseCompetitionActivityMatch) {
    const activity = cleanExtractedValue(caseCompetitionActivityMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I participated in a project activity: ${activity}.`,
        "project",
        {
          category: "project",
          factKind: "generic_project",
          scopeKind: "project",
          subject: extractBoundedEnglishSubject(activity) ?? "case competition",
        },
      ),
    );
  }

  const researchProjectMatch = trimmed.match(RESEARCH_PROJECT_PATTERN);
  if (researchProjectMatch) {
    const topic = cleanExtractedValue(researchProjectMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I worked on a research project on ${topic}.`,
        "project",
        {
          category: "project",
          factKind: "generic_project",
          scopeKind: "project",
          subject: extractBoundedEnglishSubject(topic) ?? "research project",
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

  const explicitFactMatch = trimmed.match(EXPLICIT_FACT_PATTERN);
  if (explicitFactMatch) {
    const factContent = explicitFactMatch[1]!.trim();

    if (!shouldSkipExplicitFactForProfileLikeClause(factContent, candidates)) {
      candidates.push(createFactCandidate(index, nextId, factContent));
    }
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

  const referenceMatch = trimmed.match(REFERENCE_PATTERN);
  if (referenceMatch) {
    const pointer = referenceMatch[1]!.trim();
    const title = pointer.split("/").at(-1) ?? pointer;

    candidates.push({
      id: nextId(),
      kindHint: "reference",
      explicitness: "explicit",
      content: pointer,
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        referenceKind: deriveReferenceKind(trimmed, pointer),
        referenceTitle: title,
        referencePointer: pointer,
        subject: extractReferenceSubject(trimmed) ?? "unknown",
      },
    });
  }

  const technicalReferenceMatch = trimmed.match(TECHNICAL_REFERENCE_PATTERN);
  if (technicalReferenceMatch?.[1]) {
    const pointer = technicalReferenceMatch[1];
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

  const correctedReferenceMatch = trimmed.match(CORRECTED_REFERENCE_PATTERN);
  if (correctedReferenceMatch) {
    const pointer = correctedReferenceMatch[1]!.trim();
    const previousPointer = correctedReferenceMatch[2]!.trim();
    const title = pointer.split("/").at(-1) ?? pointer;

    candidates.push({
      id: nextId(),
      kindHint: "reference",
      explicitness: "explicit",
      content: pointer,
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        referenceKind: deriveReferenceKind(trimmed, pointer),
        referenceTitle: title,
        referencePointer: pointer,
        supersedesPointer: previousPointer,
        subject: extractReferenceSubject(trimmed) ?? "unknown",
      },
    });
  }

  const correctiveFeedback = CORRECTIVE_FEEDBACK_PATTERN.test(trimmed);
  if (correctiveFeedback || looksLikeProceduralFeedback(trimmed)) {
    candidates.push({
      id: nextId(),
      kindHint: "feedback",
      explicitness: "explicit",
      content: trimmed,
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        feedbackKind: deriveFeedbackKind(trimmed),
        appliesTo: "general_response",
        ...(correctiveFeedback
          ? { attributes: { languageDurableSignal: "procedural_feedback" } }
          : {}),
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

function maybeExtractCrossClauseCandidatesFromMessage(
  content: string,
  index: number,
  nextId: () => string,
): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  const koreanRestaurantCountMatch = content.match(KOREAN_RESTAURANT_COUNT_PATTERN);

  if (koreanRestaurantCountMatch) {
    const count = cleanExtractedValue(koreanRestaurantCountMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I have tried ${count} Korean restaurants in my city.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: "korean restaurants in my city",
        },
      ),
    );
  }

  const photographyEquipmentTargets = [
    content.match(PHOTOGRAPHY_COMPATIBLE_EQUIPMENT_PATTERN)?.[1],
    content.match(PHOTOGRAPHY_LENS_EQUIPMENT_PATTERN)?.[1],
  ]
    .filter((target): target is string => typeof target === "string")
    .map(cleanEquipmentTarget)
    .filter(looksLikePhotographyEquipment);
  for (const target of [...new Set(photographyEquipmentTargets)]) {
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `My current photography setup includes ${target}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: "photography setup",
        },
      ),
    );
  }

  const professionalFieldMatch = content.match(PROFESSIONAL_FIELD_PATTERN);
  if (professionalFieldMatch) {
    const field = cleanExtractedValue(professionalFieldMatch[1]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `I work in ${field}.`,
        "technical",
        {
          category: "technical",
          scopeKind: "project",
          subject: extractBoundedEnglishSubject(field) ?? field,
        },
      ),
    );
  }

  const personalBestContextTimeMatch = content.match(
    PERSONAL_BEST_CONTEXT_TIME_PATTERN,
  );
  if (personalBestContextTimeMatch) {
    const event = cleanPersonalBestEvent(personalBestContextTimeMatch[1]!);
    const time = cleanExtractedValue(personalBestContextTimeMatch[2]!);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `My personal best time in ${event} is ${time}.`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: extractBoundedEnglishSubject(event) ?? "personal best time",
        },
      ),
    );
  }

  return candidates;
}

export function createEnglishLanguagePack(): LanguagePack {
  return {
    analyzerVersion: "7",
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
      return splitClausesGeneric(text);
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
        return tokens.filter((token) => !TOKEN_STOPWORDS.has(token));
      }
      return tokens;
    },
    buildSearchTerms(text: string): string[] {
      return tokenizeUnicodeText(text, "en-US")
        .filter((token) =>
          token.length >= 2 &&
          (!TOKEN_STOPWORDS.has(token) || token === "before")
        );
    },
    decomposeQuery: decomposeEnglishQuery,
    analyzeQuery: analyzeEnglishQuery,
    analyzeContent: analyzeEnglishContent,
    parseTemporalExpressions: parseEnglishTemporalExpressions,
    resolveTemporalReference: resolveEnglishTemporalReference,
    extractEntityMentions: extractEnglishEntityMentions,
    matchesEntityAlias(query, alias) {
      return matchesNormalizedEntityAlias(
        query,
        alias,
        normalizeUnicodeForEquality,
      );
    },
    acceptsEntityCandidate: acceptsEnglishEntityCandidate,
    render: renderEnglish,
    extractCandidates(input: LanguageCandidateExtractionInput): MemoryCandidate[] {
      const candidates: MemoryCandidate[] = [];
      const storeName = resolveUniqueStoreNameFromMessages(input.messages);

      input.messages.forEach((message, index) => {
        if (message.role !== "user") {
          return;
        }

        const sourceMessageIndex = message.sourceMessageIndex ?? index;

        candidates.push(
          ...maybeExtractCrossClauseCandidatesFromMessage(
            message.content,
            sourceMessageIndex,
            input.nextId,
          ),
        );

        const clauses = splitClausesGeneric(message.content);
        for (const clause of clauses) {
          candidates.push(
            ...maybeExtractCandidatesFromClause(
              clause,
              sourceMessageIndex,
              input.nextId,
              storeName ? { storeName } : undefined,
            ),
          );
        }
      });

      return dedupeCandidates(candidates);
    },
  };
}
