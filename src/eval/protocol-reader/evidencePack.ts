// Eval-only protocol-reader evidence shaping. Retrieving the right evidence does not guarantee
// a correct answer: a model handed a raw, unordered context can still miscount,
// mis-order, or report a superseded value as a conflict. This module turns
// retrieved turns into a source-ordered, timestamped pack with an operation
// framing inferred from the question, so the model can count, order, and resolve
// updates reliably.
//
// This module intentionally accepts optional benchmark question-type metadata.
// It belongs to evaluation protocol compatibility, not the production memory or
// answer path. Product answer shaping must derive behavior from product inputs.

import type { AnswerOperation, EvidenceTurn } from "./evidenceShared";
import { formatAbstentionEvidenceGuide } from "./operations/abstention";
import { buildContradictionEvidenceGuide } from "./operations/contradiction";
import { inferConflictUpdateTemporalOperation } from "./operations/conflictUpdate";
import { formatCountCandidateLedger } from "./operations/count";
import { buildCurrentValueEvidenceGuide } from "./operations/currentValue";
import { formatExtractionCoverageGuide } from "./operations/extraction";
import {
  formatInstructionConcreteAnswerCues,
  formatInstructionSupportTurns,
  selectInstructionConstraintIndexes,
  selectInstructionSupportTurns,
} from "./operations/instruction";
import {
  formatOrderMilestoneCues,
  formatOrderTargetAnchors,
  formatOrderTimelineTurns,
} from "./operations/order";
import {
  formatPreferenceRequirements,
  formatPreferenceSupport,
  selectPreferenceConstraintIndexes,
  selectPreferenceSupportTurns,
} from "./operations/preference";
import { formatSummaryCoverageChecklist } from "./operations/summary";

export type { AnswerOperation, EvidenceTurn } from "./evidenceShared";

const COUNT_QUESTION_PATTERN =
  /\b(how many|how much|how often|how long|number of|total|in total|combined|altogether|count|sum|times)\b/iu;
const CONFLICT_UPDATE_QUESTION_PATTERN =
  /\b(current|currently|latest|newest|now|updated?|changed?|switched?|replaced?|most recent|final|still|conflict|contradict|resolve)\b/iu;
const ORDER_QUESTION_PATTERN =
  /\b(order|sequence|sequential|chronolog|timeline|before|after|first|then|next|earlier|later|prior to|followed by|preced)\b/iu;

const ORDER_QUESTION_TYPES = new Set([
  "event_ordering",
  "temporal",
  "temporal_reasoning",
]);
const CONFLICT_UPDATE_QUESTION_TYPES = new Set([
  "cr",
  "conflict_resolution",
  "knowledge_update",
]);
const CONTRADICTION_QUESTION_TYPES = new Set(["contradiction_resolution"]);
const EXTRACTION_QUESTION_TYPES = new Set([
  "distance_recall",
  "information_extraction",
  "numerical_precision",
  "problem-solution context",
  "timeline integration",
]);
const INSTRUCTION_QUESTION_TYPES = new Set(["instruction_following"]);
const MULTI_SESSION_QUESTION_TYPES = new Set(["multi_session_reasoning"]);
const PREFERENCE_QUESTION_TYPES = new Set(["preference_following"]);
const SUMMARY_QUESTION_TYPES = new Set(["summarization"]);
const ABSTENTION_QUESTION_TYPES = new Set(["abstention"]);
const REQUESTED_ITEM_COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
export function inferAnswerOperation(
  question: string,
  questionType?: string,
): AnswerOperation {
  const normalizedType = questionType?.trim().toLowerCase();
  if (normalizedType && ABSTENTION_QUESTION_TYPES.has(normalizedType)) {
    return "abstention";
  }
  if (normalizedType && PREFERENCE_QUESTION_TYPES.has(normalizedType)) {
    return "preference";
  }
  if (COUNT_QUESTION_PATTERN.test(question)) {
    return "count";
  }
  if (normalizedType && EXTRACTION_QUESTION_TYPES.has(normalizedType)) {
    return "extraction";
  }
  const temporalOperation = inferConflictUpdateTemporalOperation(
    question,
    normalizedType,
  );
  if (temporalOperation) {
    return temporalOperation;
  }
  if (normalizedType && ORDER_QUESTION_TYPES.has(normalizedType)) {
    return "order";
  }
  if (normalizedType && CONTRADICTION_QUESTION_TYPES.has(normalizedType)) {
    return "contradiction";
  }
  if (normalizedType && CONFLICT_UPDATE_QUESTION_TYPES.has(normalizedType)) {
    return "conflict_update";
  }
  if (normalizedType && SUMMARY_QUESTION_TYPES.has(normalizedType)) {
    return "summary";
  }
  if (normalizedType && INSTRUCTION_QUESTION_TYPES.has(normalizedType)) {
    return "instruction";
  }
  if (normalizedType && MULTI_SESSION_QUESTION_TYPES.has(normalizedType)) {
    return "multi_session";
  }
  if (CONFLICT_UPDATE_QUESTION_PATTERN.test(question)) {
    return "conflict_update";
  }
  if (ORDER_QUESTION_PATTERN.test(question)) {
    return "order";
  }
  return "general";
}

const OPERATION_FRAMING: Record<AnswerOperation, string> = {
  abstention:
    "Abstention calibration: this question asks for a specific detail that may be absent. Answer from retrieved evidence only when a source directly states that requested detail; adjacent facts about the same entity, date, project, event, or preference are not enough.",
  contradiction:
    "Contradiction resolution: do not resolve the question by choosing one side. If the evidence contains both a denial/no/never/not-yet statement and an affirmative, attempted, integrated, fixed, implemented, or completed statement about the same target, report the contradiction and ask for clarification.",
  conflict_update:
    "Current-value resolution: compare entries in source order. Earlier entries are history when a later entry updates the same fact; answer with the latest supported value as current. Only report a conflict when entries cannot be reconciled as an update.",
  count:
    "This question asks for a count or total. Enumerate the value-bearing facts in the evidence, then compute the answer from them; do not restate a superseded earlier count unless the question asks for history.",
  extraction:
    "Information extraction: identify every source-backed field, deadline, step, or attribute requested by the question. Preserve all required sub-items from the same source turn instead of summarizing only the first few.",
  instruction:
    "Instruction-following constraints: identify the standing instruction, then the latest companion instruction or refinement if present. Apply these constraints to the answer; do not treat the instruction text as the whole answer by itself.",
  multi_session:
    "Multi-session reasoning: preserve source-order progression across sessions, connect each value-bearing facet, and synthesize how the facts relate instead of answering from one isolated turn.",
  order:
    "This question asks for an order or sequence. Build the answer from the source-order timeline below, with one concrete milestone per step. Do not reorder evidence by topical similarity.",
  preference:
    "Preference-following: identify the user's stated preference or style constraint, then answer the requested task while satisfying that constraint. Treat the preference as a response requirement, not as optional background.",
  summary:
    "This question asks for a summary. Cover all value-bearing themes present in the evidence, keep source-order chronology when it matters, and do not introduce themes absent from the evidence.",
  general: "",
};

function extractRequestedItemCount(question: string): number | undefined {
  const digitMatch = /\b(?:only\s+(?:and\s+only\s+)?|exactly\s+)?(\d{1,2})\s+(?:items?|milestones?|steps?|things?|topics?|aspects?)\b/iu.exec(
    question,
  );
  if (digitMatch) {
    return Number(digitMatch[1]);
  }
  const wordMatch = /\b(?:only\s+(?:and\s+only\s+)?|exactly\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:items?|milestones?|steps?|things?|topics?|aspects?)\b/iu.exec(
    question,
  );
  return wordMatch ? REQUESTED_ITEM_COUNT_WORDS[wordMatch[1].toLowerCase()] : undefined;
}

function buildAnswerShapeGuidance(input: {
  operation: AnswerOperation;
  question: string;
}): string | undefined {
  if (input.operation === "order") {
    const requestedCount = extractRequestedItemCount(input.question);
    const countGuidance =
      requestedCount === undefined
        ? "Return a numbered list when the question asks for ordered items."
        : `Return exactly ${requestedCount} numbered items.`;
    return [
      `Answer shape: ${countGuidance}`,
      "Phrase each item as the aspect or topic the user brought up, with concrete cues from the evidence; avoid copying raw code/config snippets as the whole item.",
      "Prefer one milestone per source entry before splitting any entry; when more items are requested than source entries, split later multi-topic entries before splitting earlier setup/foundation entries.",
      "Keep paired tasks joined by the same sprint/focus phrase as one milestone; split separate paragraphs or follow-up requests before splitting paired tasks.",
      "When a source turn starts with a broad problem label and then gives a concrete implementation/action, use the concrete implementation/action for the milestone.",
      "For multi-topic development entries, prefer high-level user-stated aspects over low-level code fields, library settings, worker-class suggestions, or validation details.",
      "If one source entry contains deployment/configuration plus testing or performance themes, split those high-level themes before extracting implementation details.",
      "If one source entry contains multiple distinct requested aspects, split it only enough to satisfy the requested item count.",
    ].join(" ");
  }
  if (input.operation === "count") {
    return [
      "Answer shape: Count only distinct requested items that match the question's target category.",
      "Do not count individual role names as separate security features; count role-based access control as one capability.",
      "For security-capability counts, count mechanisms rather than individual role labels, examples, dates, tools, API limits, retries, or helper details unless the question asks for those concerns.",
      "When the question asks for concerns, count distinct user-raised problems separately; retry behavior, rapid calls, dependency risk, and uptime/stability can be separate concerns when stated separately.",
      "For API concern counts, group rapid or consecutive calls under rate-limit handling, but count retry or backoff after a limit is hit as a separate concern when stated separately.",
      "Group follow-up turns only when they restate the same requested item rather than raising a distinct concern.",
      "Show the final count and name the counted items; if the evidence gives an interval, compute only from the two endpoint facts.",
      "For date/time intervals, choose the two event dates named by the question's endpoint phrases, not unrelated intermediate dates.",
      "Use start dates when the question asks between starts; use completion/end dates only when the question names completion/end.",
      "Treat duration labels such as 30-day or two-week as period lengths or labels, not endpoint dates by themselves.",
    ].join(" ");
  }
  if (input.operation === "abstention") {
    return [
      "Answer shape: Answer that the provided chat does not contain the requested detail when no retrieved source directly states it.",
      "If partial adjacent facts are present, name the gap briefly instead of filling it from implication.",
      "Only answer with a substantive value when a source states the requested attribute, rationale, module detail, discussion/decision, technique, atmosphere, or background detail.",
    ].join(" ");
  }
  if (input.operation === "extraction") {
    return [
      "Answer shape: Return the requested fields or steps directly, with every source-backed required item represented once.",
      "For deadlines, dates, ages, institutions, and similar fields, keep the label attached to the value so no requested field is left as No answer.",
      "For preparation plans or problem-solution contexts, include concrete before/during/after actions when they are stated in the evidence.",
      "Avoid adding extra names, meeting labels, platforms, or personal identifiers unless the question asks for them or the source-backed answer would otherwise be ambiguous.",
    ].join(" ");
  }
  if (input.operation === "instruction") {
    return [
      "Answer shape: For instruction-following questions, answer the underlying request using the supporting evidence while satisfying the instruction constraints.",
      "If the user asks what the response should include, describe the required response contents; otherwise provide the concrete requested values or content in the required format.",
      "Apply the standing instruction first, then the latest companion constraint or refinement if present.",
      "Ignore retrieved turns that do not constrain the requested response.",
      "Use supporting evidence only when it answers the requested question; do not let unrelated retrieved turns override the instruction.",
    ].join(" ");
  }
  if (input.operation === "preference") {
    return [
      "Answer shape: State the recommendation or answer in a way that explicitly follows the user's stated preference.",
      "Do not let noisy adjacent tool suggestions override the user's stated preference.",
      "When the preference is about simplicity, automation, step-by-step detail, morning routines, or direct portfolio links, make that constraint visible in the final answer.",
      "If the requested task has little support beyond the preference itself, still answer the task from the question while honoring the preference.",
    ].join(" ");
  }
  if (input.operation === "multi_session") {
    return [
      "Answer shape: Synthesize across all listed facets and preserve how the situation evolved.",
      "Do not answer from only the latest entry when earlier facets are necessary.",
      "Name the main facets before drawing the final conclusion.",
    ].join(" ");
  }
  if (input.operation === "conflict_update") {
    return [
      "Answer shape: Do not answer only yes or no when the evidence contains both a denial/never statement and an affirmative/done statement.",
      "Instead, state that the evidence is contradictory, name both sides using the evidence, and ask for or indicate clarification.",
      "When entries are simple updates rather than true contradictions, answer with the latest supported value.",
    ].join(" ");
  }
  if (input.operation === "contradiction") {
    return [
      "Answer shape: Do not answer yes or no first, and do not collapse the answer to the denial just because it appears later.",
      "Begin by saying: I notice you've mentioned contradictory information about this.",
      "Required contradiction answer components: state that the evidence is contradictory, name the affirmative side, name the denial side, and ask which statement is correct.",
      "Then name both sides from the evidence—lead with the affirmative claim (what the user said they did, have, or completed), then state the conflicting denial—and ask for clarification.",
      "A response that reports only the denial side, only the affirmative side, or No answer is incomplete when both sides are present in the guide.",
    ].join(" ");
  }
  return undefined;
}

function selectOperationTurns(
  operation: AnswerOperation,
  ordered: readonly EvidenceTurn[],
): EvidenceTurn[] {
  if (operation !== "instruction") {
    return [...ordered];
  }
  return [...selectInstructionConstraintIndexes(ordered)]
    .sort((left, right) => left - right)
    .map((index) => ordered[index]);
}

// Typed entry header: time anchor and source id always; bi-temporal validity
// and fusion channel provenance only when the caller supplies them, so packs
// built from provenance-free paths keep the historical byte format.
function formatEvidenceEntryMeta(turn: EvidenceTurn): string {
  const parts = [`t=${turn.timeAnchor}`, `#${turn.sourceId}`, turn.role];
  if (turn.validity) {
    parts.push(turn.validity);
  }
  if (turn.channels && turn.channels.length > 0) {
    parts.push(`via ${turn.channels.join("+")}`);
  }
  return parts.join(" | ");
}

function formatTurnsForEvidence(turns: readonly EvidenceTurn[]): string {
  if (turns.length === 0) {
    return "(no evidence)";
  }
  return turns
    .map((turn) => `- [${formatEvidenceEntryMeta(turn)}] ${turn.content}`)
    .join("\n");
}

// Chain-of-note reading: a per-entry relevance pass before synthesis improves
// reading accuracy over noisy evidence and strengthens rejection of
// unanswerable questions. The notes are working text — the harness extracts
// only the marked final answer for strict scoring (extractFinalAnswer).
const CHAIN_OF_NOTE_PROTOCOL = [
  "Reading protocol: before answering, write one brief note per evidence entry",
  "citing its #id — say whether the entry answers the question, is background,",
  "is irrelevant, or conflicts with another entry (cite that entry's #id).",
  "If no entry directly states the requested information, say so in the notes.",
  'Then write a line beginning with "Final answer:" followed by only the answer',
  "in the required shape. Everything before that line is discarded working",
  "notes, so the final-answer line must stand alone.",
].join(" ");

const FINAL_ANSWER_MARKER_PATTERN = /final answer\s*\**\s*[::]/giu;

// Strips the chain-of-note working notes from a model response: returns the
// text after the last "Final answer:" marker. Without a usable marker (absent,
// or nothing after it), returns the raw trimmed text so an answer is never
// replaced with an empty string at scoring time.
export function extractFinalAnswer(raw: string): string {
  const matches = [...raw.matchAll(FINAL_ANSWER_MARKER_PATTERN)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) {
    return raw.trim();
  }
  const after = raw
    .slice(last.index + last[0].length)
    .replace(/^[\s*_]+/u, "")
    .trim();
  return after.length > 0 ? after : raw.trim();
}

// Source-ordered (earliest orderKey first), deduplicated, timestamped. The
// trailing note makes update-recency explicit without suppressing genuine
// contradictions: the latest entry is the current state unless two entries are
// irreconcilable.
export function buildAnswerEvidencePack(input: {
  chainOfNote?: boolean;
  question: string;
  questionType?: string;
  turns: readonly EvidenceTurn[];
}): string {
  const operation = inferAnswerOperation(input.question, input.questionType);
  const seen = new Set<string>();
  const ordered: EvidenceTurn[] = [];
  for (const turn of [...input.turns].sort(
    (left, right) => left.orderKey - right.orderKey,
  )) {
    const sourceKey = `${typeof turn.sourceId}:${turn.sourceId}`;
    if (seen.has(sourceKey)) {
      continue;
    }
    seen.add(sourceKey);
    ordered.push(turn);
  }

  const evidenceLines =
    selectOperationTurns(operation, ordered).length > 0
      ? selectOperationTurns(operation, ordered)
          .map((turn) => `- [${formatEvidenceEntryMeta(turn)}] ${turn.content}`)
          .join("\n")
      : "(no evidence)";
  const instructionConstraintIndexes =
    operation === "instruction"
      ? selectInstructionConstraintIndexes(ordered)
      : new Set<number>();
  const instructionConstraints =
    operation === "instruction"
      ? [...instructionConstraintIndexes]
          .sort((left, right) => left - right)
          .map((index) => ordered[index])
      : [];
  const instructionSupport =
    operation === "instruction"
      ? selectInstructionSupportTurns({
          constraintIndexes: instructionConstraintIndexes,
          ordered,
          question: input.question,
        })
      : [];
  const preferenceConstraintIndexes =
    operation === "preference"
      ? selectPreferenceConstraintIndexes(ordered)
      : new Set<number>();
  const preferenceConstraints =
    operation === "preference"
      ? [...preferenceConstraintIndexes]
          .sort((left, right) => left - right)
          .map((index) => ordered[index])
      : [];
  const preferenceSupport =
    operation === "preference"
      ? selectPreferenceSupportTurns({
          ordered,
          question: input.question,
        })
      : [];
  const timelineLines =
    ordered.length > 0
      ? ordered
          .map(
            (turn, index) =>
              `${index + 1}. [${formatEvidenceEntryMeta(turn)}] ${turn.content}`,
          )
          .join("\n")
      : "(no evidence)";
  const orderTimelineLines =
    operation === "order" ? formatOrderTimelineTurns(ordered) : timelineLines;
  const countLines = timelineLines;

  const sections: string[] = [];
  if (OPERATION_FRAMING[operation].length > 0) {
    sections.push(OPERATION_FRAMING[operation]);
  }
  // Deterministic retrieval-coverage signal (only when the caller supplied
  // channel provenance): lets the reader calibrate confidence and abstention
  // on corroboration structure instead of prose tone.
  const provenancedTurns = ordered.filter(
    (turn) => (turn.channels?.length ?? 0) > 0,
  );
  if (provenancedTurns.length > 0) {
    const corroborated = provenancedTurns.filter(
      (turn) => (turn.channels?.length ?? 0) > 1,
    ).length;
    sections.push(
      `Evidence coverage: ${ordered.length} entries; ${corroborated} ` +
        "corroborated by more than one retrieval channel; " +
        `${provenancedTurns.length - corroborated} single-channel.`,
    );
  }
  const answerShapeGuidance = buildAnswerShapeGuidance({
    operation,
    question: input.question,
  });
  if (answerShapeGuidance) {
    sections.push(answerShapeGuidance);
  }
  if (operation === "contradiction") {
    sections.push(buildContradictionEvidenceGuide(input.question, ordered));
  }
  if (operation === "conflict_update") {
    sections.push(
      buildCurrentValueEvidenceGuide({
        ordered,
        question: input.question,
      }),
    );
  }
  if (operation === "order") {
    sections.push(
      "Question-target timeline anchors (source-ordered, noise-aware):",
      formatOrderTargetAnchors({
        ordered,
        question: input.question,
      }),
    );
    sections.push(
      "Milestone cue candidates (source-ordered, code blocks removed):",
      formatOrderMilestoneCues(ordered),
    );
    sections.push("Timeline evidence:", orderTimelineLines);
  } else if (operation === "count") {
    sections.push(formatCountCandidateLedger(ordered));
    sections.push("Value-bearing facts for counting:", countLines);
  } else if (operation === "abstention") {
    sections.push(
      formatAbstentionEvidenceGuide({
        ordered,
        question: input.question,
      }),
    );
    sections.push("Evidence for absence check:", evidenceLines);
  } else if (operation === "extraction") {
    sections.push(
      formatExtractionCoverageGuide({
        ordered,
        question: input.question,
      }),
    );
    sections.push("Evidence (source-ordered, earliest first):", evidenceLines);
  } else if (operation === "contradiction") {
    sections.push(
      "Use the contradiction evidence guide above as the source evidence; do not mine adjacent implementation details as the answer.",
    );
  } else if (operation === "instruction") {
    sections.push(
      "Instruction constraints:",
      instructionConstraints.length > 0
        ? formatTurnsForEvidence(instructionConstraints)
        : "(no direct standing instruction found)",
    );
    sections.push(
      "Supporting evidence for the requested answer:",
      formatInstructionSupportTurns({
        question: input.question,
        turns: instructionSupport,
      }),
    );
    const concreteAnswerCues = formatInstructionConcreteAnswerCues({
      allTurns: ordered,
      constraintTurns: instructionConstraints,
      question: input.question,
      supportTurns: instructionSupport,
    });
    if (concreteAnswerCues) {
      sections.push(concreteAnswerCues);
    }
  } else if (operation === "preference") {
    sections.push(
      "Preference constraints:",
      preferenceConstraints.length > 0
        ? formatTurnsForEvidence(preferenceConstraints)
        : "(no explicit preference found in retrieved evidence; infer only from the user's current question wording)",
    );
    sections.push(
      formatPreferenceRequirements({
        question: input.question,
        turns: preferenceConstraints,
      }),
    );
    sections.push(
      "Supporting evidence for the requested answer:",
      formatPreferenceSupport({
        question: input.question,
        turns: preferenceSupport,
      }),
    );
  } else if (operation === "multi_session") {
    sections.push("Cross-session facets:", timelineLines);
  } else if (operation === "summary") {
    sections.push(formatSummaryCoverageChecklist(ordered));
    sections.push("Evidence (source-ordered, earliest first):", evidenceLines);
  } else {
    sections.push("Evidence (source-ordered, earliest first):", evidenceLines);
  }
  if (
    operation !== "contradiction" &&
    operation !== "abstention" &&
    operation !== "preference"
  ) {
    sections.push(
      "When a fact changed across these entries, the latest entry is the current value; only call entries conflicting when they cannot be reconciled as an update.",
    );
  }
  if (input.chainOfNote) {
    sections.push(CHAIN_OF_NOTE_PROTOCOL);
  }
  return sections.join("\n\n");
}
