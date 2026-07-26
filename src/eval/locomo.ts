// LoCoMo (Phase 65) evaluation contract and synthetic smoke fixtures.
//
// Upstream: https://github.com/snap-research/locomo (dataset `data/locomo10.json`,
// released under CC BY-NC 4.0 — NON-COMMERCIAL). LoCoMo is a very-long-term
// conversational-memory benchmark: ten multi-session conversations between two
// speakers (avg ~300 turns / ~9K tokens over up to 35 sessions), each annotated
// with question-answering pairs whose gold evidence is a list of dialog-turn ids.
//
// Because the licence is non-commercial we do NOT vendor any upstream data. This
// module defines a normalized case shape, the deterministic answer metrics
// (LoCoMo's primary QA metric is token-level F1, plus an adversarial-abstention
// check), the upstream category-code mapping, and a small synthetic smoke fixture
// (one case per QA category) so the Phase 65 adapter can be built and gated
// before any external-root run.

export const LOCOMO_UPSTREAM_COMMIT =
  "cbfbc1dba6bc53d00625212a0f22d55ffee7c1fc";
export const LOCOMO_UPSTREAM_SHA256 =
  "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4";
export const LOCOMO_UPSTREAM_URL =
  `https://raw.githubusercontent.com/snap-research/locomo/${LOCOMO_UPSTREAM_COMMIT}/data/locomo10.json`;

const LOCOMO_DATE_TIME_PATTERN =
  /^(\d{1,2}):(\d{2}) (am|pm) on (\d{1,2}) ([A-Z][a-z]+), (\d{4})$/u;
const LOCOMO_ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const LOCOMO_MONTHS = new Map([
  ["January", 0],
  ["February", 1],
  ["March", 2],
  ["April", 3],
  ["May", 4],
  ["June", 5],
  ["July", 6],
  ["August", 7],
  ["September", 8],
  ["October", 9],
  ["November", 10],
  ["December", 11],
]);

export function normalizeLocomoDateTime(value: string): string {
  if (LOCOMO_ISO_DATE_TIME_PATTERN.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value) {
      return value;
    }
  }

  const match = LOCOMO_DATE_TIME_PATTERN.exec(value);
  const month = match === null ? undefined : LOCOMO_MONTHS.get(match[5]);
  if (match === null || month === undefined) {
    throw new Error(`Invalid LoCoMo date/time: ${value}`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const day = Number(match[4]);
  const year = Number(match[6]);
  if (hour < 1 || hour > 12 || minute > 59 || day < 1 || day > 31) {
    throw new Error(`Invalid LoCoMo date/time: ${value}`);
  }

  const hour24 = hour % 12 + (match[3] === "pm" ? 12 : 0);
  const parsed = new Date(Date.UTC(year, month, day, hour24, minute));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour24 ||
    parsed.getUTCMinutes() !== minute
  ) {
    throw new Error(`Invalid LoCoMo date/time: ${value}`);
  }
  return parsed.toISOString();
}

// Exact inverse of normalizeLocomoDateTime for upstream-shaped inputs:
// renders a normalized ISO timestamp back to the upstream human form
// ("1:56 pm on 8 May, 2023"). Non-ISO values pass through unchanged, so
// render sites stay stable on roots that already carry raw date strings.
// Rationale (drift attribution, 2026-07-26): machine-format dates in seeded
// turn markers cost −3.6pt official end-to-end; storage keeps ISO, rendering
// keeps the human shape.
export function formatLocomoHumanDateTime(value: string): string {
  if (!LOCOMO_ISO_DATE_TIME_PATTERN.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    return value;
  }
  const monthName = [...LOCOMO_MONTHS.entries()].find(
    ([, index]) => index === parsed.getUTCMonth(),
  )?.[0];
  if (monthName === undefined) {
    return value;
  }
  const hour24 = parsed.getUTCHours();
  const meridiem = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minute = String(parsed.getUTCMinutes()).padStart(2, "0");
  return `${hour12}:${minute} ${meridiem} on ${parsed.getUTCDate()} ${monthName}, ${parsed.getUTCFullYear()}`;
}

// Upstream QA "category" is an integer 1-5; these are the normalized names.
export const LOCOMO_QA_CATEGORIES = [
  "single_hop",
  "multi_hop",
  "temporal",
  "open_domain",
  "adversarial",
] as const;

export type LocomoQaCategory = (typeof LOCOMO_QA_CATEGORIES)[number];

// The upstream integer "category" code -> normalized category name. Verified
// against snap-research/locomo: 1 multi-hop, 2 temporal, 3 open-domain, 4
// single-hop, 5 adversarial. External normalization (raw locomo10.json ->
// normalized cases.json) applies this; it lives here so the mapping is recorded
// in one auditable place rather than re-derived per consumer.
export const LOCOMO_UPSTREAM_CATEGORY_CODES: Record<number, LocomoQaCategory> = {
  1: "multi_hop",
  2: "temporal",
  3: "open_domain",
  4: "single_hop",
  5: "adversarial",
};

export function normalizeLocomoCategoryCode(code: number): LocomoQaCategory {
  const category = LOCOMO_UPSTREAM_CATEGORY_CODES[code];
  if (category === undefined) {
    throw new Error(`Unknown LoCoMo category code: ${code}`);
  }
  return category;
}

// LoCoMo scores answerable QA with token-level F1; adversarial questions are
// scored on whether the model resists the tempting answer (abstention). The
// smoke contract carries the mode each category is graded with so a later live
// mode applies the matching deterministic check.
export const LOCOMO_MATCH_MODES = [
  "f1_token_overlap",
  "exact_match",
  "adversarial_abstention",
] as const;

export type LocomoMatchMode = (typeof LOCOMO_MATCH_MODES)[number];

// Categories 1-4 are answerable and scored with token-F1; category 5 is
// adversarial and scored on abstention from the tempting answer.
export function deriveLocomoMatchMode(
  category: LocomoQaCategory,
): LocomoMatchMode {
  return category === "adversarial" ? "adversarial_abstention" : "f1_token_overlap";
}

// One dialog turn. `diaId` is the upstream "dia_id" string, formatted
// "D<session>:<turn>" (e.g. "D1:3"); the recall diagnostic keys on it.
export interface LocomoTurn {
  content: string;
  // Canonical UTC ISO date/time of the turn's session, when upstream provides it.
  date?: string;
  diaId: string;
  speaker: string;
}

// One QA sample against the conversation. `evidenceTurnIds` are the dia_ids
// carrying the gold evidence (the upstream "evidence" list; may be empty for an
// unanswerable adversarial probe). `adversarialAnswer` is the tempting wrong
// answer the model must NOT give (null for non-adversarial categories).
export interface LocomoQuestion {
  adversarialAnswer: string | null;
  category: LocomoQaCategory;
  evidenceTurnIds: string[];
  goldAnswer: string;
  matchMode: LocomoMatchMode;
  question: string;
  questionId: string;
}

export interface LocomoCase {
  caseId: string;
  questions: LocomoQuestion[];
  // Mirrors the upstream conversation index (e.g. "conversation-1"); synthetic
  // fixtures use a "synthetic-*" prefix.
  sourceConversation: string;
  // The two conversation participants, in upstream order.
  speakers: [string, string];
  turns: LocomoTurn[];
}

const LOCOMO_DIA_ID_PATTERN = /^D(\d+):\d+$/u;

// The 1-based session index encoded in a dia_id ("D3:7" -> 3). Multi-hop recall
// diagnostics use this to confirm cross-session composition.
export function parseLocomoSession(diaId: string): number {
  const match = LOCOMO_DIA_ID_PATTERN.exec(diaId);
  if (match === null) {
    throw new Error(`Malformed LoCoMo dia_id: ${diaId}`);
  }
  return Number(match[1]);
}

// SQuAD-style token normalization (lowercase, drop punctuation and the leading
// articles a/an/the, collapse whitespace) — the basis of LoCoMo's F1 metric.
const LOCOMO_F1_ARTICLES = new Set(["a", "an", "the"]);

export function normalizeLocomoAnswer(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function tokenizeLocomoAnswer(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length > 0 && !LOCOMO_F1_ARTICLES.has(token));
}

// Token-level F1 (multiset overlap), LoCoMo's primary QA metric. Returns 1 when
// both sides normalize to empty, 0 when exactly one does (SQuAD convention).
export function locomoTokenF1(answer: string, gold: string): number {
  const answerTokens = tokenizeLocomoAnswer(answer);
  const goldTokens = tokenizeLocomoAnswer(gold);
  if (answerTokens.length === 0 || goldTokens.length === 0) {
    return answerTokens.length === 0 && goldTokens.length === 0 ? 1 : 0;
  }
  const goldCounts = new Map<string, number>();
  for (const token of goldTokens) {
    goldCounts.set(token, (goldCounts.get(token) ?? 0) + 1);
  }
  let overlap = 0;
  for (const token of answerTokens) {
    const remaining = goldCounts.get(token) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      goldCounts.set(token, remaining - 1);
    }
  }
  if (overlap === 0) {
    return 0;
  }
  const precision = overlap / answerTokens.length;
  const recall = overlap / goldTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

export function locomoExactMatch(answer: string, gold: string): boolean {
  return normalizeLocomoAnswer(answer) === normalizeLocomoAnswer(gold);
}

const LOCOMO_NO_INFORMATION_GOLD = "no information available";

function normalizeLocomoAbstentionText(value: string): string {
  return tokenizeLocomoAnswer(value.replace(/['’]/gu, "")).join(" ");
}

const LOCOMO_ABSTENTION_ALIASES = new Set([
  "i do not know",
  "i dont know",
  "unknown",
  "not enough information",
  "no information available",
  "no information",
].map(normalizeLocomoAbstentionText));
const LOCOMO_NO_INFORMATION_GOLD_NORMALIZED = normalizeLocomoAbstentionText(
  LOCOMO_NO_INFORMATION_GOLD,
);

function isLocomoAbstention(answer: string): boolean {
  return LOCOMO_ABSTENTION_ALIASES.has(normalizeLocomoAbstentionText(answer));
}

function isLocomoNoInformationGold(gold: string): boolean {
  return (
    normalizeLocomoAbstentionText(gold) ===
    LOCOMO_NO_INFORMATION_GOLD_NORMALIZED
  );
}

// Deterministic pass threshold for the token-F1 modes. LoCoMo reports the raw F1
// number; the smoke uses this threshold as the boolean gate, and a live mode can
// still report locomoTokenF1() directly.
export const LOCOMO_F1_PASS_THRESHOLD = 0.5;

// Deterministic correctness for the deferred live-answer layer. f1_token_overlap
// passes when token-F1 with the gold answer clears the threshold; exact_match is
// normalized equality; adversarial_abstention passes only when the answer resists
// the tempting answer AND either matches the gold or explicitly abstains when
// upstream gold is "No information available".
export function scoreLocomoAnswer(input: {
  adversarialAnswer?: string | null;
  answer: string;
  goldAnswer: string;
  matchMode: LocomoMatchMode;
}): boolean {
  if (input.matchMode === "exact_match") {
    return locomoExactMatch(input.answer, input.goldAnswer);
  }
  if (input.matchMode === "adversarial_abstention") {
    const abstainsFromNoInformation =
      isLocomoNoInformationGold(input.goldAnswer) &&
      isLocomoAbstention(input.answer);
    const matchesGold =
      abstainsFromNoInformation ||
      locomoTokenF1(input.answer, input.goldAnswer) >= LOCOMO_F1_PASS_THRESHOLD;
    const tempting = input.adversarialAnswer ?? null;
    const tookTheBait =
      tempting !== null &&
      locomoTokenF1(input.answer, tempting) >= LOCOMO_F1_PASS_THRESHOLD;
    return matchesGold && !tookTheBait;
  }
  return locomoTokenF1(input.answer, input.goldAnswer) >= LOCOMO_F1_PASS_THRESHOLD;
}

export const LOCOMO_OFFICIAL_QA_SCORER_V1 =
  `snap-research/locomo@${LOCOMO_UPSTREAM_COMMIT}:task_eval/evaluation.py:v1` as const;

export type LocomoOfficialQaMethodV1 =
  | "single-answer-f1"
  | "multi-answer-f1"
  | "adversarial-abstention";

export interface LocomoOfficialQaScoreV1 {
  category: LocomoQaCategory;
  method: LocomoOfficialQaMethodV1;
  score: number;
  scorerVersion: typeof LOCOMO_OFFICIAL_QA_SCORER_V1;
}

const LOCOMO_OFFICIAL_ASCII_PUNCTUATION = new Set(
  Array.from("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"),
);

const LOCOMO_PORTER_IRREGULAR_FORMS = new Map([
  ["sky", "sky"],
  ["skies", "sky"],
  ["dying", "die"],
  ["lying", "lie"],
  ["tying", "tie"],
  ["news", "news"],
  ["innings", "inning"],
  ["inning", "inning"],
  ["outings", "outing"],
  ["outing", "outing"],
  ["cannings", "canning"],
  ["canning", "canning"],
  ["howe", "howe"],
  ["proceed", "proceed"],
  ["exceed", "exceed"],
  ["succeed", "succeed"],
]);

const LOCOMO_PORTER_VOWELS = new Set(["a", "e", "i", "o", "u"]);

function isLocomoPorterConsonant(word: string, index: number): boolean {
  const character = word[index] ?? "";
  if (LOCOMO_PORTER_VOWELS.has(character)) {
    return false;
  }
  if (character === "y") {
    return index === 0 || !isLocomoPorterConsonant(word, index - 1);
  }
  return true;
}

function locomoPorterMeasure(word: string): number {
  let measure = 0;
  for (let index = 1; index < word.length; index += 1) {
    if (
      !isLocomoPorterConsonant(word, index - 1) &&
      isLocomoPorterConsonant(word, index)
    ) {
      measure += 1;
    }
  }
  return measure;
}

function locomoPorterContainsVowel(word: string): boolean {
  for (let index = 0; index < word.length; index += 1) {
    if (!isLocomoPorterConsonant(word, index)) {
      return true;
    }
  }
  return false;
}

function locomoPorterEndsDoubleConsonant(word: string): boolean {
  return (
    word.length >= 2 &&
    word.at(-1) === word.at(-2) &&
    isLocomoPorterConsonant(word, word.length - 1)
  );
}

function locomoPorterEndsCvc(word: string): boolean {
  return (
    (
      word.length >= 3 &&
      isLocomoPorterConsonant(word, word.length - 3) &&
      !isLocomoPorterConsonant(word, word.length - 2) &&
      isLocomoPorterConsonant(word, word.length - 1) &&
      !["w", "x", "y"].includes(word.at(-1) ?? "")
    ) ||
    (
      word.length === 2 &&
      !isLocomoPorterConsonant(word, 0) &&
      isLocomoPorterConsonant(word, 1)
    )
  );
}

interface LocomoPorterRule {
  condition?: (stem: string) => boolean;
  replacement: string;
  suffix: string;
}

function applyLocomoPorterRules(
  word: string,
  rules: readonly LocomoPorterRule[],
): string {
  for (const rule of rules) {
    if (!word.endsWith(rule.suffix)) {
      continue;
    }
    const stem = rule.suffix.length === 0
      ? word
      : word.slice(0, -rule.suffix.length);
    return rule.condition === undefined || rule.condition(stem)
      ? `${stem}${rule.replacement}`
      : word;
  }
  return word;
}

function locomoPorterStep1a(word: string): string {
  if (word.endsWith("ies") && word.length === 4) {
    return `${word.slice(0, -3)}ie`;
  }
  return applyLocomoPorterRules(word, [
    { suffix: "sses", replacement: "ss" },
    { suffix: "ies", replacement: "i" },
    { suffix: "ss", replacement: "ss" },
    { suffix: "s", replacement: "" },
  ]);
}

function locomoPorterStep1b(word: string): string {
  if (word.endsWith("ied")) {
    return `${word.slice(0, -3)}${word.length === 4 ? "ie" : "i"}`;
  }
  if (word.endsWith("eed")) {
    const stem = word.slice(0, -3);
    return locomoPorterMeasure(stem) > 0 ? `${stem}ee` : word;
  }

  let stem: string | undefined;
  for (const suffix of ["ed", "ing"] as const) {
    if (word.endsWith(suffix)) {
      const candidate = word.slice(0, -suffix.length);
      if (locomoPorterContainsVowel(candidate)) {
        stem = candidate;
        break;
      }
    }
  }
  if (stem === undefined) {
    return word;
  }
  if (stem.endsWith("at")) {
    return `${stem}e`;
  }
  if (stem.endsWith("bl")) {
    return `${stem}e`;
  }
  if (stem.endsWith("iz")) {
    return `${stem}e`;
  }
  if (
    locomoPorterEndsDoubleConsonant(stem) &&
    !["l", "s", "z"].includes(stem.at(-1) ?? "")
  ) {
    return stem.slice(0, -1);
  }
  if (locomoPorterMeasure(stem) === 1 && locomoPorterEndsCvc(stem)) {
    return `${stem}e`;
  }
  return stem;
}

function locomoPorterStep1c(word: string): string {
  if (!word.endsWith("y")) {
    return word;
  }
  const stem = word.slice(0, -1);
  return stem.length > 1 && isLocomoPorterConsonant(stem, stem.length - 1)
    ? `${stem}i`
    : word;
}

function locomoPorterStep2(word: string): string {
  if (word.endsWith("alli")) {
    const stem = word.slice(0, -4);
    if (locomoPorterMeasure(stem) > 0) {
      return locomoPorterStep2(`${stem}al`);
    }
  }
  const positiveMeasure = (stem: string): boolean =>
    locomoPorterMeasure(stem) > 0;
  return applyLocomoPorterRules(word, [
    { suffix: "ational", replacement: "ate", condition: positiveMeasure },
    { suffix: "tional", replacement: "tion", condition: positiveMeasure },
    { suffix: "enci", replacement: "ence", condition: positiveMeasure },
    { suffix: "anci", replacement: "ance", condition: positiveMeasure },
    { suffix: "izer", replacement: "ize", condition: positiveMeasure },
    { suffix: "bli", replacement: "ble", condition: positiveMeasure },
    { suffix: "alli", replacement: "al", condition: positiveMeasure },
    { suffix: "entli", replacement: "ent", condition: positiveMeasure },
    { suffix: "eli", replacement: "e", condition: positiveMeasure },
    { suffix: "ousli", replacement: "ous", condition: positiveMeasure },
    { suffix: "ization", replacement: "ize", condition: positiveMeasure },
    { suffix: "ation", replacement: "ate", condition: positiveMeasure },
    { suffix: "ator", replacement: "ate", condition: positiveMeasure },
    { suffix: "alism", replacement: "al", condition: positiveMeasure },
    { suffix: "iveness", replacement: "ive", condition: positiveMeasure },
    { suffix: "fulness", replacement: "ful", condition: positiveMeasure },
    { suffix: "ousness", replacement: "ous", condition: positiveMeasure },
    { suffix: "aliti", replacement: "al", condition: positiveMeasure },
    { suffix: "iviti", replacement: "ive", condition: positiveMeasure },
    { suffix: "biliti", replacement: "ble", condition: positiveMeasure },
    { suffix: "fulli", replacement: "ful", condition: positiveMeasure },
    {
      suffix: "logi",
      replacement: "log",
      condition: () => locomoPorterMeasure(word.slice(0, -3)) > 0,
    },
  ]);
}

function locomoPorterStep3(word: string): string {
  const positiveMeasure = (stem: string): boolean =>
    locomoPorterMeasure(stem) > 0;
  return applyLocomoPorterRules(word, [
    { suffix: "icate", replacement: "ic", condition: positiveMeasure },
    { suffix: "ative", replacement: "", condition: positiveMeasure },
    { suffix: "alize", replacement: "al", condition: positiveMeasure },
    { suffix: "iciti", replacement: "ic", condition: positiveMeasure },
    { suffix: "ical", replacement: "ic", condition: positiveMeasure },
    { suffix: "ful", replacement: "", condition: positiveMeasure },
    { suffix: "ness", replacement: "", condition: positiveMeasure },
  ]);
}

function locomoPorterStep4(word: string): string {
  const measureGreaterThanOne = (stem: string): boolean =>
    locomoPorterMeasure(stem) > 1;
  return applyLocomoPorterRules(word, [
    { suffix: "al", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ance", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ence", replacement: "", condition: measureGreaterThanOne },
    { suffix: "er", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ic", replacement: "", condition: measureGreaterThanOne },
    { suffix: "able", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ible", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ant", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ement", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ment", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ent", replacement: "", condition: measureGreaterThanOne },
    {
      suffix: "ion",
      replacement: "",
      condition: (stem) =>
        locomoPorterMeasure(stem) > 1 && ["s", "t"].includes(stem.at(-1) ?? ""),
    },
    { suffix: "ou", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ism", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ate", replacement: "", condition: measureGreaterThanOne },
    { suffix: "iti", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ous", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ive", replacement: "", condition: measureGreaterThanOne },
    { suffix: "ize", replacement: "", condition: measureGreaterThanOne },
  ]);
}

function locomoPorterStep5a(word: string): string {
  if (!word.endsWith("e")) {
    return word;
  }
  const stem = word.slice(0, -1);
  const measure = locomoPorterMeasure(stem);
  return measure > 1 || (measure === 1 && !locomoPorterEndsCvc(stem))
    ? stem
    : word;
}

function locomoPorterStep5b(word: string): string {
  return word.endsWith("ll") && locomoPorterMeasure(word.slice(0, -1)) > 1
    ? word.slice(0, -1)
    : word;
}

function stemLocomoOfficialToken(value: string): string {
  const word = value.toLowerCase();
  const irregular = LOCOMO_PORTER_IRREGULAR_FORMS.get(word);
  if (irregular !== undefined) {
    return irregular;
  }
  if (word.length <= 2) {
    return word;
  }
  return locomoPorterStep5b(
    locomoPorterStep5a(
      locomoPorterStep4(
        locomoPorterStep3(
          locomoPorterStep2(
            locomoPorterStep1c(
              locomoPorterStep1b(locomoPorterStep1a(word)),
            ),
          ),
        ),
      ),
    ),
  );
}

function normalizeLocomoOfficialAnswerV1(value: string): string {
  const withoutPunctuation = Array.from(value.replaceAll(",", "").toLowerCase())
    .filter((character) => !LOCOMO_OFFICIAL_ASCII_PUNCTUATION.has(character))
    .join("");
  return withoutPunctuation
    .replace(/\b(?:a|an|the|and)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function locomoOfficialTokenF1V1(answer: string, gold: string): number {
  const answerNormalized = normalizeLocomoOfficialAnswerV1(answer);
  const goldNormalized = normalizeLocomoOfficialAnswerV1(gold);
  const answerTokens = answerNormalized.length === 0
    ? []
    : answerNormalized.split(" ").map(stemLocomoOfficialToken);
  const goldTokens = goldNormalized.length === 0
    ? []
    : goldNormalized.split(" ").map(stemLocomoOfficialToken);
  const goldCounts = new Map<string, number>();
  for (const token of goldTokens) {
    goldCounts.set(token, (goldCounts.get(token) ?? 0) + 1);
  }
  let overlap = 0;
  for (const token of answerTokens) {
    const remaining = goldCounts.get(token) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      goldCounts.set(token, remaining - 1);
    }
  }
  if (overlap === 0) {
    return 0;
  }
  const precision = overlap / answerTokens.length;
  const recall = overlap / goldTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function locomoOfficialMultiAnswerF1V1(answer: string, gold: string): number {
  const answers = answer.split(",");
  const goldAnswers = gold.split(",");
  const scores = goldAnswers.map((goldAnswer) =>
    Math.max(...answers.map((candidate) =>
      locomoOfficialTokenF1V1(candidate, goldAnswer))),
  );
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

// Exact, versioned port of the category-aware QA scorer at the pinned upstream
// revision. The legacy boolean scorer above remains unchanged for compatibility.
export function scoreLocomoOfficialQaV1(input: {
  answer: string;
  category: LocomoQaCategory;
  goldAnswer: string;
}): LocomoOfficialQaScoreV1 {
  let method: LocomoOfficialQaMethodV1;
  let score: number;
  if (input.category === "adversarial") {
    const answer = input.answer.toLowerCase();
    method = "adversarial-abstention";
    score = answer.includes("no information available") ||
      answer.includes("not mentioned")
      ? 1
      : 0;
  } else if (input.category === "multi_hop") {
    method = "multi-answer-f1";
    score = locomoOfficialMultiAnswerF1V1(input.answer, input.goldAnswer);
  } else {
    method = "single-answer-f1";
    const goldAnswer = input.category === "open_domain"
      ? input.goldAnswer.split(";", 1)[0] ?? ""
      : input.goldAnswer;
    score = locomoOfficialTokenF1V1(input.answer, goldAnswer);
  }
  return {
    category: input.category,
    method,
    score,
    scorerVersion: LOCOMO_OFFICIAL_QA_SCORER_V1,
  };
}

// Synthetic smoke fixture: one small multi-session conversation per QA category,
// following the LoCoMo turn/QA shape. No upstream data is vendored.
export function buildLocomoSmokeCases(): LocomoCase[] {
  return [
    // single_hop: a fact stated in one turn, asked directly.
    {
      caseId: "synthetic-single-hop-dog",
      sourceConversation: "synthetic-conversation-1",
      speakers: ["Caroline", "Melanie"],
      turns: [
        {
          diaId: "D1:1",
          speaker: "Melanie",
          content: "Hey Caroline! Anything new with you this spring?",
        },
        {
          diaId: "D1:2",
          speaker: "Caroline",
          content:
            "Yes! I adopted a dog named Pepper on 10 March 2023 — she's a rescue beagle.",
        },
      ],
      questions: [
        {
          questionId: "synthetic-single-hop-dog:1",
          category: "single_hop",
          question: "What is the name of Caroline's dog?",
          goldAnswer: "Pepper",
          matchMode: "f1_token_overlap",
          evidenceTurnIds: ["D1:2"],
          adversarialAnswer: null,
        },
      ],
    },
    // multi_hop: composition across two sessions.
    {
      caseId: "synthetic-multi-hop-visit",
      sourceConversation: "synthetic-conversation-2",
      speakers: ["Caroline", "Melanie"],
      turns: [
        {
          diaId: "D1:1",
          speaker: "Caroline",
          content: "My sister Anna just moved to Seattle for a new job.",
        },
        {
          diaId: "D1:2",
          speaker: "Melanie",
          content: "That's exciting! Hope you get to see her soon.",
        },
        {
          diaId: "D3:1",
          speaker: "Caroline",
          content: "I'm finally flying out to visit my sister this weekend.",
        },
      ],
      questions: [
        {
          questionId: "synthetic-multi-hop-visit:1",
          category: "multi_hop",
          question: "Which city is Caroline flying to this weekend?",
          goldAnswer: "Seattle",
          matchMode: "f1_token_overlap",
          evidenceTurnIds: ["D1:1", "D3:1"],
          adversarialAnswer: null,
        },
      ],
    },
    // temporal: date arithmetic across turns.
    {
      caseId: "synthetic-temporal-promotion",
      sourceConversation: "synthetic-conversation-3",
      speakers: ["Caroline", "Melanie"],
      turns: [
        {
          diaId: "D1:1",
          speaker: "Caroline",
          content: "I started my new job on 1 February 2023.",
        },
        {
          diaId: "D2:1",
          speaker: "Caroline",
          content: "Great news — I got promoted exactly three months after starting.",
        },
      ],
      questions: [
        {
          questionId: "synthetic-temporal-promotion:1",
          category: "temporal",
          question: "On what date was Caroline promoted?",
          goldAnswer: "1 May 2023",
          matchMode: "f1_token_overlap",
          evidenceTurnIds: ["D1:1", "D2:1"],
          adversarialAnswer: null,
        },
      ],
    },
    // open_domain: a stated persona preference.
    {
      caseId: "synthetic-open-domain-cuisine",
      sourceConversation: "synthetic-conversation-4",
      speakers: ["Caroline", "Melanie"],
      turns: [
        {
          diaId: "D1:1",
          speaker: "Melanie",
          content: "We should grab dinner sometime. What are you into these days?",
        },
        {
          diaId: "D1:2",
          speaker: "Caroline",
          content: "My favorite cuisine is Thai food — the spicier the better.",
        },
      ],
      questions: [
        {
          questionId: "synthetic-open-domain-cuisine:1",
          category: "open_domain",
          question: "What type of cuisine does Caroline prefer?",
          goldAnswer: "Thai",
          matchMode: "f1_token_overlap",
          evidenceTurnIds: ["D1:2"],
          adversarialAnswer: null,
        },
      ],
    },
    // adversarial: a tempting "Yes" the turn refutes.
    {
      caseId: "synthetic-adversarial-bowl",
      sourceConversation: "synthetic-conversation-5",
      speakers: ["Caroline", "Melanie"],
      turns: [
        {
          diaId: "D1:1",
          speaker: "Melanie",
          content: "That black and white bowl in your photo is gorgeous!",
        },
        {
          diaId: "D1:2",
          speaker: "Melanie",
          content: "Did you make it in your pottery class?",
        },
        {
          diaId: "D1:3",
          speaker: "Caroline",
          content: "No, my sister Anna made that bowl; I only made the blue mug.",
        },
      ],
      questions: [
        {
          questionId: "synthetic-adversarial-bowl:1",
          category: "adversarial",
          question: "Did Caroline make the black and white bowl in the photo?",
          goldAnswer: "No",
          matchMode: "adversarial_abstention",
          evidenceTurnIds: ["D1:3"],
          adversarialAnswer: "Yes",
        },
      ],
    },
  ];
}

// Per-question evaluation result for the Phase 65 smoke report.
export interface LocomoQuestionResult {
  answerCorrect: boolean;
  caseId: string;
  category: LocomoQaCategory;
  // Evidence dia_ids the system retrieved (when the adapter can report them).
  evidenceRecall: number;
  noiseTurnCount: number;
  questionId: string;
}

export interface LocomoCategorySummary {
  answerAccuracy: number;
  averageEvidenceRecall: number;
  category: LocomoQaCategory;
  correctCount: number;
  noiseTurnTotal: number;
  questionCount: number;
}

export function summarizeLocomoResults(
  results: LocomoQuestionResult[],
): LocomoCategorySummary[] {
  return LOCOMO_QA_CATEGORIES.map((category) => {
    const bucket = results.filter((result) => result.category === category);
    const questionCount = bucket.length;
    const correctCount = bucket.filter((result) => result.answerCorrect).length;
    const recallTotal = bucket.reduce(
      (sum, result) => sum + result.evidenceRecall,
      0,
    );
    return {
      answerAccuracy: questionCount === 0 ? 0 : correctCount / questionCount,
      averageEvidenceRecall:
        questionCount === 0 ? 0 : recallTotal / questionCount,
      category,
      correctCount,
      noiseTurnTotal: bucket.reduce(
        (sum, result) => sum + result.noiseTurnCount,
        0,
      ),
      questionCount,
    };
  });
}
