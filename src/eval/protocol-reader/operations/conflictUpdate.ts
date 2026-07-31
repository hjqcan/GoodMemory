const CONFLICT_UPDATE_QUESTION_TYPES = new Set([
  "cr",
  "conflict_resolution",
  "knowledge_update",
]);
const HISTORICAL_VALUE_QUESTION_PATTERN =
  /\b(before|previous|previously|used to|formerly|originally|initially|prior to|earlier)\b/iu;
const DATE_VALUE_QUESTION_PATTERN =
  /^(?:when|what date|which date|on what date)\b/iu;
const CURRENT_VALUE_REQUEST_PATTERN =
  /\b(current|currently|latest|newest|now|most recent|still|as of)\b/iu;

export function inferConflictUpdateTemporalOperation(
  question: string,
  questionType: string | undefined,
): "extraction" | "order" | undefined {
  if (!questionType || !CONFLICT_UPDATE_QUESTION_TYPES.has(questionType)) {
    return undefined;
  }
  if (HISTORICAL_VALUE_QUESTION_PATTERN.test(question)) {
    return "order";
  }
  if (
    DATE_VALUE_QUESTION_PATTERN.test(question) &&
    !CURRENT_VALUE_REQUEST_PATTERN.test(question)
  ) {
    return "extraction";
  }
  return undefined;
}
