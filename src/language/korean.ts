import type { MemoryCandidate } from "../domain/memoryCandidate";
import {
  attachLanguageDurableTarget,
  createLanguageDurableOptOutDisposition,
  deriveLanguageDurableTarget,
} from "./durableTarget";
import type { FactKind } from "../domain/records";
import type {
  LanguageContentAnalysis,
  LanguageEntityMention,
  LanguagePack,
  LanguageQueryAnalysis,
  LanguageRenderInput,
  LanguageRenderKey,
  LanguageTemporalExpression,
} from "./contracts";
import {
  collectProtectedRetrievalTokens,
  expandExplicitFactCandidateClauses,
  isExplicitlyQuotedValue,
  maskQuotedText,
  normalizeUnicodeForEquality,
  splitClausesGeneric,
  splitTrailingInterrogativeClause,
  tokenizeUnicodeText,
} from "./generic";
import {
  analyzeBehavioralRuleWithPatterns,
  createSourceOfTruthReferenceCandidate,
  decomposeQueryByPattern,
  extractPatternMentions,
  matchesNormalizedEntityAlias,
  parseTechnicalTemporalExpressions,
  renderFromCatalog,
  resolveSourceOfTruthDirective,
  splitSentencesGeneric,
} from "./packHelpers";
import {
  canResolveOccurrenceExpression,
  hasOccurrenceResolutionContext,
  maskQuotedTemporalLiterals,
} from "./temporal";

const KOREAN_INTERROGATIVE_ROOTS = [
  "무엇",
  "뭐",
  "뭘",
  "누구",
  "누굴",
  "누가",
  "무슨",
  "어디",
  "어딜",
  "언제",
  "왜",
  "어째서",
  "어찌",
  "어떻게",
  "어느",
  "어떤",
  "몇",
  "얼마",
] as const;
const KOREAN_INTERROGATIVE_ROOT_SET = new Set<string>(
  KOREAN_INTERROGATIVE_ROOTS,
);
const KOREAN_STOPWORDS = new Set([
  "그리고",
  "그러나",
  "그것",
  "여기",
  "저기",
  "저는",
  "제가",
  "지금",
  "현재",
  "해주세요",
  ...KOREAN_INTERROGATIVE_ROOTS,
]);
const KOREAN_INTERROGATIVE_ROOT_SOURCE =
  `(?:${KOREAN_INTERROGATIVE_ROOTS.join("|")})`;
const KOREAN_INTERROGATIVE_TOKEN_PATTERN = new RegExp(
  `^${KOREAN_INTERROGATIVE_ROOT_SOURCE}(?:은|는|이|가|을|를|의|에|도|만)?$`,
  "u",
);
const KOREAN_DURABLE_TARGET_ALIASES = {
  선호: "preference",
  선호도: "preference",
  시간대: "profile:timezone",
  이름: "profile:name",
  프로젝트코드: "project_code",
  "프로젝트 코드": "project_code",
  "프로젝트 암호명": "project_code",
} as const;

const COMPLETED_FIRST_PERSON_EVENT_PATTERN =
  /^(?:저는|제가|나는|내가)[^.!?。！？]+(?:했습니다|하였습니다|았습니다|었습니다|였습니다|했어요|았어요|었어요)[.!?。！？]?$/u;
const KOREAN_FIRST_PERSON_EVENT_PATTERN = /^(?:저는|제가|나는|내가)/u;
const KOREAN_CONTRACTED_PAST_FORMAL_SUFFIX_PATTERN =
  /\u11BB\u1109\u1173\u11B8\u1102\u1175\u1103\u1161$/u;
const FUTURE_FIRST_PERSON_PLAN_PATTERN =
  /^(?:저는|제가|나는|내가)[^.!?。！？]*(?:할\s+예정입니다|할\s+것입니다|할\s+계획입니다|하려고\s+합니다)[.!?。！？]?$/u;

function isCompletedKoreanFirstPersonEvent(content: string): boolean {
  if (!KOREAN_FIRST_PERSON_EVENT_PATTERN.test(content)) {
    return false;
  }
  if (COMPLETED_FIRST_PERSON_EVENT_PATTERN.test(content)) {
    return true;
  }
  return KOREAN_CONTRACTED_PAST_FORMAL_SUFFIX_PATTERN.test(
    content.replace(/[.!?。！？]+$/u, "").normalize("NFD"),
  );
}
const KOREAN_COMPLETED_PREDICATE_PATTERN =
  /([\p{Script=Hangul}]+?)(?:습니까|습니다|나요|어요|는지)$/u;

function koreanCompletedEventPredicate(text: string): string | undefined {
  const stem = text
    .trim()
    .replace(/[.!?。！？]+$/u, "")
    .match(KOREAN_COMPLETED_PREDICATE_PATTERN)?.[1];
  if (!stem || !stem.normalize("NFD").endsWith("\u11BB")) {
    return undefined;
  }
  if (stem.endsWith("했")) {
    return `${stem.slice(0, -1)}하`;
  }
  if (stem.endsWith("하였")) {
    return `${stem.slice(0, -2)}하`;
  }
  return stem;
}

function matchesKoreanEventPredicate(query: string, candidate: string): boolean {
  const queryPredicate = koreanCompletedEventPredicate(query);
  return queryPredicate !== undefined &&
    queryPredicate === koreanCompletedEventPredicate(candidate);
}

const BEHAVIORAL_RULE_PATTERNS = {
  firstAction: [
    /(?:먼저|우선|첫\s*단계로)\s*([A-Za-z_][A-Za-z0-9_@.-]*)/u,
    /([A-Za-z_][A-Za-z0-9_@.-]*)(?:을|를)?\s*(?:먼저|우선|첫\s*단계로)/u,
  ],
  format: /(시작|첫머리|끝|마무리|접두사|접미사|서명|제목|형식)/u,
  general: /(항상|반드시|해야|앞으로|언제나|매번)/u,
  hostAction: {
    destination: [
      /['"`]([^'"`]+)['"`](?:로|으로|에)\s*(?:복사|이동)/u,
      /((?:~\/|\/)[A-Za-z0-9._/-]+)(?:로|으로|에)\s*(?:복사|이동)/u,
    ],
    verbs: [
      { pattern: /복사/u, value: "copy" },
      { pattern: /이동/u, value: "move" },
    ],
  },
  negative: /(피해|하지\s*마|해서는\s*안|금지|절대.+않|대신)/u,
  trigger: [
    /^(.+?)(?:에서는|에는|일\s*때|할\s*때)(?:[,，]|\s)/u,
  ],
} as const;

const KOREAN_PARTICLE_PATTERN =
  /(?:으로부터|에게서|에서는|으로는|까지는|부터는|에게는|에서는|으로|에서|에게|한테|부터|까지|보다|처럼|하고|이며|이고|께서|에는|으로|로|은|는|이|가|을|를|의|에|와|과|도|만)$/u;

const QUERY = {
  actionDriving:
    /(진행|보내|발송|게시|공개|출시|배포|실행|결정|다음 단계|편집|수정|변경|삭제|작성|확인해|검토해)/u,
  after: /(이후|이래|후에|뒤에|다음부터)/u,
  aggregateCount: /(몇\s*(?:개|건|명|회)|얼마|총합|합계|전부|전체|모두 합쳐)/u,
  answer: /(답변|응답|회신|요약|정리|초안)/u,
  assistantEvidenceRecall:
    /(이전|지난번|아까|앞서|당신이\s*(?:말한|알려 준|제안한|추천한)|전에\s*당신이|다시 알려)/u,
  before: /(이전|전에|전까지|보다 앞서)/u,
  blocker: /(장애\s*요인|차단|막힌|막고|승인\s*대기|걸림돌)/u,
  change: /(변경|바뀌|전환|교체|대신|더 이상)/u,
  confirm: /(확인|맞는지)/u,
  continuation: /(계속|이어(?:서|가기)|재개|지난 작업|하던 작업)/u,
  current: /(현재|지금|최신|현시점)/u,
  directFactualLookup: /^(?:누가|누구|무엇|뭐|어디|언제|어느|어떤|몇|얼마)/u,
  exhaustiveList: /(모두|전부|전체|목록|남은|미완료|미해결|보류)/u,
  factConfirmationTarget:
    /(역할|직책|집중|장애\s*요인|미완료|승인|검증|상태)/u,
  focus: /(집중|주력|중점|초점)/u,
  guidanceSeeking: /(선호|원하는|형식|스타일|말투|규칙|지침|피해야|답변 방법)/u,
  history: /(이력|역사|과거|이전 기록|그동안|시간 순)/u,
  openLoop: /(미완료|미해결|열린\s*항목|남은\s*(?:일|항목)|할\s*일|TODO|확인 필요)/iu,
  procedural: /(어떻게|절차|방법|단계|워크플로|실행서|런북)/u,
  projectState:
    /(프로젝트|워크플로|이전 작업|마이그레이션|출시|배포|승인|장애\s*요인|미완료|검증)/u,
  recommendationStyle: /(추천|제안|조언|어떤 방법|어떻게 하는 게 좋)/u,
  reference: /(실행서|런북|안내서|문서|참조|기준 문서|사실의 원천|정본)/u,
  relation: /(관계|관련|연결|어떻게 연결|누구에게 보고|멘토)/u,
  role: /(역할|직책|직위)/u,
} as const;

const CONTENT = {
  assistantAcknowledgement:
    /^(알겠습니다|확인했습니다|기록했습니다|업데이트했습니다|네|좋습니다|완료했습니다)[.!?。！？]?$/u,
  assistantContinuity: /(앞으로|계속|다음|후속|유지|업데이트|확인|진행하겠습니다)/u,
  blockerFact: /(장애\s*요인|차단|막힌|승인\s*대기|걸림돌)/u,
  correctionCue: /(정정|수정|교체|대신|더 이상|기준 문서|정본)/u,
  dont: /(하지\s*마|말아\s*주세요|피해\s*주세요|금지|절대.+않)/u,
  durableCue:
    /(기억해|기억해\s*주세요|잊지\s*마|기준 문서|정본|현재 역할|시간대|선호 언어|현재.+집중|프로젝트|장애\s*요인)/u,
  focusFact: /(현재.+집중|지금.+집중|현재의?\s*(?:중점|초점|주력))/u,
  negative: /(차단|실패|미완료|미해결|불안정|막힌|장애)/u,
  openLoopFact:
    /(미완료|미해결|열린\s*항목|남아\s*있|해야\s*할|필요가\s*있|완료해야)/u,
  personalEvidence: /(?:^|[\s,，])(?:저는|제가|저의|나는|내가|나의|제)(?:[\s,，]|$)/u,
  positive: /(안정|해결|완료|수정됨|닫힘|성공)/u,
  preferenceEvidence: /(선호|좋아|원하|관심|피하고 싶|싫어|어려움|문제)/u,
  prefer: /(선호|더 좋아|우선해)/u,
  projectStateFact:
    /(프로젝트.+(?:단계|상태)|다음\s*(?:이정표|단계)|보류|대기|남아|검토\s*중|확인\s*대기)/u,
  roleFact: /(?:제|저의|나의)?\s*현재 역할은|저는\s+.+(?:담당자|엔지니어|관리자|책임자)/u,
  sensitiveCredential:
    /(?:API\s*)?(?:키|비밀번호|암호|비밀\s*키|시크릿|토큰)\s*[:=：]\s*\S+/iu,
  unresolved: /(미완료|미해결|남은|보류|장애\s*요인|다음 단계|확인 필요|후속)/u,
  validated: /(효과적|잘 작동|도움이 되었|성공적|계속 사용)/u,
} as const;

const KOREAN_EXPLICIT_FACT_DIRECTIVE_PATTERN =
  /^(?:이것을\s*)?(?:(?:(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|\d+)\s*가지(?:를)?\s*)?(?:기억해\s*(?:주세요|두세요|둬)|잊지\s*마세요))(?=[：:,，.!?。！？；;\s]|$)/u;
const KOREAN_EXPLICIT_FACT_COUNT_PATTERN =
  /^(?:이것을\s*)?(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|\d+)\s*가지(?:를)?/u;
const KOREAN_EXPLICIT_FACT_OPT_OUT_PATTERN =
  /(?:기억하지\s*마세요|기억하지\s*말아\s*주세요|저장하지\s*마세요|잊어\s*주세요)[.!。！]?\s*$/u;
const KOREAN_EXPLICIT_FACT_QUESTION_PATTERN = new RegExp(
  `${KOREAN_INTERROGATIVE_ROOT_SOURCE}(?:$|.*(?:인가요|인가|입니까|나요|까요|습니까|예요|이에요)$)`,
  "u",
);
const KOREAN_EXPLICIT_FACT_POSTPOSED_QUESTION_VALUE_PATTERN = new RegExp(
  `[,，、]\\s*${KOREAN_INTERROGATIVE_ROOT_SOURCE}(?:야|예요|이에요|인가요|인가|나요|까요|입니까)?$`,
  "u",
);
const KOREAN_EXPLICIT_FACT_CONFIRMATION_PATTERN =
  /(?:맞|옳|정확하)(?:나요|습니까|습니까요|는지)?[?？]?\s*$/u;
const KOREAN_CONFIRMATION_QUESTION_PATTERN =
  /(?:죠|지요|잖아요|맞죠)[.!。！]?$/u;
const KOREAN_CLEAR_TRAILING_QUESTION_PATTERN = new RegExp(
  `${KOREAN_INTERROGATIVE_ROOT_SOURCE}.*(?:입니까|합니까|인가요|나요|까요|습니까|습니까요|는지)\\s*$|(?:입니까|합니까|인가요|나요|까요|습니까|습니까요|는지)\\s*$`,
  "u",
);
const KOREAN_EXPLICIT_FACT_OPT_OUT_CLAUSE_BOUNDARY_PATTERN =
  /(?:[,，]\s*|\s*(?:그리고|하지만|그러나)\s*)(?=[^.!?。！？；;\n]{0,240}(?:기억하지\s*마세요|기억하지\s*말아\s*주세요|저장하지\s*마세요|잊어\s*주세요))/u;

function koreanFactCount(content: string): number {
  const token = content.match(KOREAN_EXPLICIT_FACT_COUNT_PATTERN)?.[1];
  if (!token) {
    return 1;
  }
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 0) {
    return numeric;
  }
  const counts: Readonly<Record<string, number>> = {
    다섯: 5,
    두: 2,
    세: 3,
    아홉: 9,
    여덟: 8,
    여섯: 6,
    열: 10,
    일곱: 7,
    한: 1,
    네: 4,
  };
  return counts[token] ?? 1;
}

function splitKoreanClauses(text: string): string[] {
  return splitClausesGeneric(text)
    .flatMap((clause) =>
      KOREAN_EXPLICIT_FACT_DIRECTIVE_PATTERN.test(clause.trim()) ||
        KOREAN_EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : splitTrailingInterrogativeClause(
          clause,
          (candidate) => isKoreanInterrogativeClause(candidate, candidate),
          (candidate) =>
            /[?？]\s*$/u.test(maskQuotedText(candidate)) ||
            KOREAN_CLEAR_TRAILING_QUESTION_PATTERN.test(
              maskQuotedText(candidate).trim(),
            ),
        )
    )
    .flatMap((clause) =>
      !KOREAN_EXPLICIT_FACT_DIRECTIVE_PATTERN.test(clause.trim()) &&
        KOREAN_EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : clause.split(KOREAN_EXPLICIT_FACT_OPT_OUT_CLAUSE_BOUNDARY_PATTERN)
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function stripKoreanParticle(token: string): string | undefined {
  const stripped = token.replace(KOREAN_PARTICLE_PATTERN, "");
  return stripped.length >= 2 && stripped !== token ? stripped : undefined;
}

function koreanTokenVariants(text: string): string[] {
  const tokens: string[] = [];
  for (const token of tokenizeUnicodeText(text, "ko-KR")) {
    tokens.push(token);
    const stripped = stripKoreanParticle(token);
    if (stripped) {
      tokens.push(stripped);
    }
  }
  return [...new Set(tokens)];
}

function isKoreanInterrogativeToken(token: string): boolean {
  if (
    KOREAN_INTERROGATIVE_ROOT_SET.has(token) ||
    KOREAN_INTERROGATIVE_TOKEN_PATTERN.test(token)
  ) {
    return true;
  }
  const stripped = stripKoreanParticle(token);
  if (stripped !== undefined && KOREAN_INTERROGATIVE_ROOT_SET.has(stripped)) {
    return true;
  }
  return KOREAN_INTERROGATIVE_ROOTS.some((root) =>
    token.startsWith(root) &&
    /^(?:(?:은|는|이|가|을|를)?(?:인가요|인가|입니까|나요|까요|습니까|예요|이에요|야)?)$/u.test(
      token.slice(root.length),
    )
  );
}

function koreanRetrievalTokens(text: string): string[] {
  const protectedTokens = new Set(
    collectProtectedRetrievalTokens(text, "ko-KR"),
  );
  for (const token of [...protectedTokens]) {
    const stripped = stripKoreanParticle(token);
    if (stripped) {
      protectedTokens.add(stripped);
    }
  }
  return koreanTokenVariants(text).filter((token) =>
    protectedTokens.has(token) ||
    (!KOREAN_STOPWORDS.has(token) && !isKoreanInterrogativeToken(token))
  );
}

function analyzeKoreanQuery(query: string): LanguageQueryAnalysis {
  const role = QUERY.role.test(query);
  const focus = QUERY.focus.test(query);
  const blocker = QUERY.blocker.test(query);
  const openLoop = QUERY.openLoop.test(query);
  const before = QUERY.before.test(query.replace(/\d{1,3}\s*일\s*전/gu, ""));
  const occurrenceExpression = parseKoreanTemporalExpressions(query)[0];
  const eventOccurrenceQueryMode = (():
    LanguageQueryAnalysis["eventOccurrenceQueryMode"] => {
    if (!occurrenceExpression) {
      return undefined;
    }
    const expressionIndex = query.indexOf(occurrenceExpression.raw);
    if (expressionIndex >= 0) {
      const prefix = query.slice(0, expressionIndex);
      const suffix = query.slice(expressionIndex + occurrenceExpression.raw.length);
      if (
        /(?:이전|전까지|보다\s*앞서|이후|후에)\s*$/u.test(prefix) ||
        /^\s*(?:이전|전까지|보다\s*앞서|이후|후에|보다\s*앞서)/u.test(suffix) ||
        /[「『“"]\s*$/u.test(prefix) && /^\s*[」』”"]/u.test(suffix)
      ) {
        return undefined;
      }
    }
    if (
      /무슨\s+일[^.!?。！？]{0,20}(?:있었|발생했)[^.!?。！？]{0,20}(?:나요|습니까|어요)/u.test(
        query,
      )
    ) {
      return "broad";
    }
    return /(?:무엇|뭐|어디|누구|어떤)/u.test(query) &&
        koreanCompletedEventPredicate(query)
      ? "predicate"
      : undefined;
  })();
  const userGroundedEventOrder =
    /(순서|순차|시간순|처음[\s\S]{0,80}마지막)/u.test(query) &&
    /(?:제가|내가|저는|나는)[\s\S]{0,80}(?:언급|말한|이야기한|다룬)/u.test(
      query,
    );

  return {
    actionDriving: QUERY.actionDriving.test(query),
    after: QUERY.after.test(query),
    aggregateCount: QUERY.aggregateCount.test(query),
    answerComposition: QUERY.answer.test(query),
    assistantEvidenceRecall: QUERY.assistantEvidenceRecall.test(query),
    before,
    blocker,
    change: QUERY.change.test(query),
    continuation: QUERY.continuation.test(query),
    current: QUERY.current.test(query),
    directFactualLookup: QUERY.directFactualLookup.test(query.trim()),
    eventOccurrenceQuery: eventOccurrenceQueryMode !== undefined,
    ...(eventOccurrenceQueryMode ? { eventOccurrenceQueryMode } : {}),
    exhaustiveList: QUERY.exhaustiveList.test(query),
    factConfirmation: role || focus || blocker || openLoop ||
      (QUERY.confirm.test(query) && QUERY.factConfirmationTarget.test(query)),
    focus,
    guidanceSeeking: QUERY.guidanceSeeking.test(query),
    history: QUERY.history.test(query),
    openLoop,
    procedural: QUERY.procedural.test(query),
    projectState: QUERY.projectState.test(query),
    recommendationStyle: QUERY.recommendationStyle.test(query),
    relation: QUERY.relation.test(query),
    referenceSeeking: QUERY.reference.test(query),
    role,
    userGroundedEventOrder,
  };
}

function analyzeKoreanSourceOfTruthDirective(content: string) {
  const negated = (index: number, pointerLength: number): boolean => {
    const prefix = content.slice(Math.max(0, index - 96), index);
    const suffix = content.slice(index + pointerLength, index + pointerLength + 128);
    return (
      /(?:대신|말고)\s*$/u.test(prefix) ||
      /^\s*(?:은|는|을|를)?\s*(?:더 이상\s*)?(?:사용|참조)하지/u.test(suffix) ||
      /^\s*(?:은|는|이|가)?\s*(?:기준 문서|정본)이?\s*아니/u.test(suffix)
    );
  };

  return resolveSourceOfTruthDirective(content, {
    affirmed(index, pointerLength) {
      if (negated(index, pointerLength)) {
        return false;
      }
      const suffix = content.slice(
        index + pointerLength,
        index + pointerLength + 160,
      );
      return /^\s*(?:을|를|이|가)?\s*(?:현재\s*)?(?:기준 문서|정본|사실의 원천)(?:로|으로|이|가)/u.test(
        suffix,
      );
    },
    negated,
  });
}

function analyzeKoreanContent(content: string): LanguageContentAnalysis {
  const factPolarity = CONTENT.negative.test(content)
    ? "negative"
    : CONTENT.positive.test(content)
    ? "positive"
    : "unknown";
  const feedbackKind = CONTENT.validated.test(content)
    ? "validated_pattern"
    : CONTENT.dont.test(content)
    ? "dont"
    : CONTENT.prefer.test(content)
    ? "prefer"
    : "do";

  return {
    assistantAcknowledgement: CONTENT.assistantAcknowledgement.test(
      content.trim(),
    ),
    assistantContinuity: CONTENT.assistantContinuity.test(content),
    blockerFact: CONTENT.blockerFact.test(content),
    correctionCue: CONTENT.correctionCue.test(content),
    durableCue: CONTENT.durableCue.test(content),
    factPolarity,
    feedbackKind,
    focusFact: CONTENT.focusFact.test(content),
    interrogative: isKoreanInterrogativeClause(content, content),
    openLoopFact: CONTENT.openLoopFact.test(content),
    personalEvidence: CONTENT.personalEvidence.test(content),
    preferenceEvidence: CONTENT.preferenceEvidence.test(content),
    projectStateFact: CONTENT.projectStateFact.test(content),
    roleFact: CONTENT.roleFact.test(content),
    sensitiveCredential: CONTENT.sensitiveCredential.test(content),
    sourceOfTruthDirective: analyzeKoreanSourceOfTruthDirective(content),
    unresolved: CONTENT.unresolved.test(content),
  };
}

function koreanFactKind(
  content: string,
  providedAnalysis?: LanguageContentAnalysis,
): FactKind {
  const analysis = providedAnalysis ?? analyzeKoreanContent(content);
  if (analysis.roleFact) return "role_update";
  if (analysis.blockerFact) return "blocker";
  if (analysis.openLoopFact) return "open_loop";
  if (analysis.focusFact) return "focus_update";
  if (analysis.projectStateFact) return "project_state";
  return "generic_project";
}

function cleanCandidateValue(value: string): string {
  return value
    .trim()
    .replace(/(?:입니다|이에요|예요)$/u, "")
    .replace(/[.!?。！？,，;；]+$/u, "")
    .trim();
}

function cleanKoreanExplicitFact(value: string): string {
  return cleanCandidateValue(
    value.replace(/^[：:,，.!?。！？；;\s]+/u, ""),
  );
}

function extractKoreanOptOutTarget(content: string): string {
  return content
    .replace(KOREAN_EXPLICIT_FACT_OPT_OUT_PATTERN, "")
    .replace(/(?:은|는|이|가|을|를)\s*$/u, "")
    .trim();
}

function isKoreanInterrogativeClause(
  content: string,
  source: string,
): boolean {
  const unquotedContent = maskQuotedText(content).trim();
  const unquotedSource = maskQuotedText(source).trim();
  if (KOREAN_CONFIRMATION_QUESTION_PATTERN.test(unquotedContent)) {
    return true;
  }
  const assignmentIndex = content.search(/[=＝]/u);
  if (assignmentIndex >= 0) {
    const left = content.slice(0, assignmentIndex).trim();
    const right = content.slice(assignmentIndex + 1).trim();
    if (KOREAN_EXPLICIT_FACT_QUESTION_PATTERN.test(left)) {
      return true;
    }
    const assignmentConfirmation =
      KOREAN_EXPLICIT_FACT_CONFIRMATION_PATTERN.test(right) &&
      /(?:나요|습니까|습니까요|는지)\s*$/u.test(right);
    if (assignmentConfirmation) {
      return true;
    }
    if (isExplicitlyQuotedValue(right)) {
      return false;
    }
    if (KOREAN_EXPLICIT_FACT_POSTPOSED_QUESTION_VALUE_PATTERN.test(right)) {
      return true;
    }
    if (/[?？]\s*$/u.test(unquotedSource)) {
      return true;
    }
    return false;
  }

  return /[?？]\s*$/u.test(unquotedSource) ||
    /(?:입니까|합니까|인가요|나요|까요|습니까|습니까요|는지)\s*$/u.test(
      unquotedContent,
    ) ||
    KOREAN_EXPLICIT_FACT_QUESTION_PATTERN.test(unquotedContent);
}

function extractKoreanExplicitFacts(content: string) {
  const source = content.trim();
  const directive = source.match(KOREAN_EXPLICIT_FACT_DIRECTIVE_PATTERN);
  if (!directive) {
    return KOREAN_EXPLICIT_FACT_OPT_OUT_PATTERN.test(source)
      ? {
        clauses: [{ content: source, disposition: "feedback" as const }],
        status: "complete" as const,
      }
      : undefined;
  }

  const expectedFactCount = koreanFactCount(source);
  const clauses = splitKoreanClauses(source.slice(directive[0].length));
  const cleanedClauses = clauses
    .map((sourceClause) => ({
      content: cleanKoreanExplicitFact(sourceClause),
      sourceClause,
    }))
    .filter(({ content }) => content.length > 0);
  if (cleanedClauses.length < expectedFactCount) {
    return KOREAN_EXPLICIT_FACT_COUNT_PATTERN.test(source)
      ? {
        clauses: cleanedClauses.map(({ content: clause, sourceClause }) => ({
          content: clause,
          disposition: KOREAN_EXPLICIT_FACT_OPT_OUT_PATTERN.test(sourceClause)
            ? "feedback" as const
            : "fact" as const,
        })),
        status: "incomplete-counted-list" as const,
      }
      : { clauses: [], status: "invalid" as const };
  }
  if (cleanedClauses.some(({ content: clause, sourceClause }) =>
    !KOREAN_EXPLICIT_FACT_OPT_OUT_PATTERN.test(sourceClause) &&
    isKoreanInterrogativeClause(clause, sourceClause)
  )) {
    return { clauses: [], status: "invalid" as const };
  }

  return {
    clauses: cleanedClauses
      .slice(0, expectedFactCount)
      .map(({ content: clause, sourceClause }) => ({
        content: clause,
        disposition: KOREAN_EXPLICIT_FACT_OPT_OUT_PATTERN.test(sourceClause)
          ? "feedback" as const
          : "fact" as const,
      })),
    status: "complete" as const,
  };
}

function extractKoreanCandidates(
  input: Parameters<LanguagePack["extractCandidates"]>[0],
): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];

  for (const [index, message] of input.messages.entries()) {
    if (message.role !== "user") {
      continue;
    }
    const sourceMessageIndex = message.sourceMessageIndex ?? index;
    const content = message.content;
    const clauses = expandExplicitFactCandidateClauses(
      content,
      extractKoreanExplicitFacts,
      splitKoreanClauses,
    );
    const sourceAnalysis = message.analysis ?? analyzeKoreanContent(content);
    for (const clause of clauses) {
      const clauseIsExplicit = clause.disposition === "fact";
      const text = clause.content.trim();
      const clauseAnalysis = clauses.length === 1 && clause.content === content
        ? sourceAnalysis
        : analyzeKoreanContent(text);
      if (clause.disposition === "feedback") {
        const optOutTarget = extractKoreanOptOutTarget(text);
        candidates.push({
          content: cleanCandidateValue(text),
          disposition: createLanguageDurableOptOutDisposition(
            optOutTarget,
            KOREAN_DURABLE_TARGET_ALIASES,
          ),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "feedback",
          metadata: {
            appliesTo: "general_response",
            feedbackKind: "dont",
            optOutTarget,
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
        continue;
      }
      if (
        clause.disposition === "ordinary" &&
        isKoreanInterrogativeClause(text, text)
      ) {
        continue;
      }
      if (FUTURE_FIRST_PERSON_PLAN_PATTERN.test(text)) {
        candidates.push({
          content: cleanCandidateValue(text),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "personal",
            factKind: "open_loop",
            scopeKind: "identity",
            subject: "unknown",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
        continue;
      }
      const occurrenceContext = hasKoreanOccurrenceContext(message);
      const occurrenceEvent = extractKoreanOccurrenceEvent(
        text,
        {
          locale: input.locale,
          observedAt: message.observedAt,
          timezone: message.timezone,
        },
      );
      if (occurrenceEvent) {
        candidates.push({
          content: occurrenceEvent.content,
          explicitness: occurrenceContext || clauseIsExplicit
            ? "explicit"
            : "inferred",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "event",
            occurrenceExpression: occurrenceEvent.occurrenceExpression,
            scopeKind: "identity",
            subject: "unknown",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
        continue;
      }
      const sourceOfTruthReference = createSourceOfTruthReferenceCandidate({
        analysis: clauseAnalysis,
        nextId: input.nextId,
        sourceMessageIndex,
      });
      if (sourceOfTruthReference) {
        candidates.push(sourceOfTruthReference);
      }
      const goal = text.match(
        /(?:제|저의|나의)?\s*(?:현재 )?(?:목표|최우선 과제)는\s*([^.!?。！？]+?)(?:입니다|이에요|예요)?[.!?。！？]?$/u,
      )?.[1];
      const timezone = text.match(
        /(?:제|저의|나의)?\s*시간대는\s*([A-Za-z0-9_./+-]+)(?:입니다|이에요|예요)?[.!?。！？]?$/u,
      )?.[1];
      if (timezone) {
        candidates.push({
          content: timezone,
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "profile",
          metadata: { profileField: "timezone" },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }
      if (goal) {
        candidates.push({
          content: cleanCandidateValue(goal),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "goal",
            factKind: "focus_update",
            scopeKind: "project",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }
      const name = text.match(
        /(?:제|저의|나의)\s*(?:이름|성명)은\s*([^.!?。！？,，;；]+?)(?:입니다|이에요|예요)?[.!?。！？]?$/u,
      );
      if (name?.[1]) {
        candidates.push({
          content: cleanCandidateValue(name[1]),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "profile",
          metadata: { profileField: "name" },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const role = text.match(
        /(?:제|저의|나의)?\s*현재 역할은\s*([^.!?。！？,，;；]+?)(?:입니다|이에요|예요)?[.!?。！？]?$/u,
      );
      if (role?.[1]) {
        candidates.push({
          content: cleanCandidateValue(role[1]),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "profile",
          metadata: { profileField: "role" },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const project = text.match(
        /(?:제|저의|나의)?\s*현재 프로젝트는\s*([^.!?。！？,，;；]+?)(?:입니다|이에요|예요)?[.!?。！？]?$/u,
      )?.[1];
      if (project) {
        candidates.push({
          content: cleanCandidateValue(project),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "project",
            factKind: "generic_project",
            scopeKind: "project",
            subject: "unknown",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const preference = text.match(
        /(?:저는|나는|제가|내가)\s*([^.!?。！？,，;；]+?)(?:을|를)\s*(?:선호합니다|선호해요|좋아합니다|좋아해요)/u,
      );
      if (preference?.[1]) {
        const preferenceValue = cleanCandidateValue(preference[1]);
        candidates.push({
          content: preferenceValue,
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "preference",
          metadata: {
            preferenceCategory: "response_style",
            preferenceValue,
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const feedback =
        /^(?:앞으로|항상|반드시|우선)|(?:하지\s*마|말아\s*주세요|피해\s*주세요)/u
          .test(text);
      if (
        clauseIsExplicit &&
        !goal &&
        !timezone &&
        !name &&
        !role &&
        !project &&
        !preference &&
        !clauseAnalysis.sourceOfTruthDirective &&
        !feedback
      ) {
        const fact = text;
        if (fact) {
          candidates.push({
            content: fact,
            explicitness: "explicit",
            id: input.nextId(),
            kindHint: "fact",
            metadata: {
              category: "project",
              factKind: koreanFactKind(fact, clauseAnalysis),
              scopeKind: "project",
              subject: "unknown",
            },
            sourceMessageIndex,
            sourceRole: "user",
          });
        }
      } else if (
        !name &&
        !role &&
        !project &&
        !preference &&
        !sourceOfTruthReference &&
        text.length >= 8 &&
        /(현재|지금|장애\s*요인|차단|미완료|프로젝트|마이그레이션|출시|배포)/u.test(
          text,
        )
      ) {
        const fact = cleanCandidateValue(text);
        candidates.push({
          content: fact,
          explicitness: "inferred",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "project",
            factKind: koreanFactKind(fact, clauseAnalysis),
            scopeKind: "project",
            subject: "unknown",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      if (feedback) {
        candidates.push({
          content: cleanCandidateValue(text),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "feedback",
          metadata: {
            appliesTo: "general_response",
            feedbackKind: clauseAnalysis.feedbackKind,
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kindHint}\u0000${candidate.content}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).map((candidate) =>
    attachLanguageDurableTarget(
      candidate,
      KOREAN_DURABLE_TARGET_ALIASES,
    )
  );
}

function parseKoreanTemporalExpressions(
  text: string,
): LanguageTemporalExpression[] {
  const expressions: LanguageTemporalExpression[] = [];
  const technical = parseTechnicalTemporalExpressions(text);
  const instant = technical.find((expression) => "iso" in expression);
  if (instant) {
    return [instant, ...technical.filter(({ raw }) => raw !== instant.raw)];
  }
  const koreanDate = text.match(
    /(\d{4})\s*년\s*(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?/u,
  );
  if (koreanDate) {
    expressions.push({
      kind: "absolute",
      raw: koreanDate[0],
      calendar: {
        ...(koreanDate[3] ? { day: Number(koreanDate[3]) } : {}),
        month: Number(koreanDate[2]),
        year: Number(koreanDate[1]),
      },
    });
  } else {
    const koreanYear = text.match(/(?:^|[^\d])(\d{4})\s*년(?:$|[^\d])/u);
    if (koreanYear) {
      expressions.push({
        kind: "absolute",
        raw: koreanYear[0].trim(),
        calendar: { year: Number(koreanYear[1]) },
      });
    }
  }

  const amountRelative = text.match(
    /(\d{1,3})\s*(일|주|개월|달|년)\s*(전|후)/u,
  );
  if (amountRelative) {
    const units = {
      개월: "month",
      년: "year",
      달: "month",
      일: "day",
      주: "week",
    } as const;
    expressions.push({
      kind: "relative",
      raw: amountRelative[0],
      offset: Number(amountRelative[1]) * (amountRelative[3] === "전" ? -1 : 1),
      unit: units[amountRelative[2] as keyof typeof units],
    });
  } else {
    const relativeDays = [
      [/그저께/u, -2],
      [/어제/u, -1],
      [/오늘/u, 0],
      [/모레/u, 2],
      [/내일/u, 1],
    ] as const;
    for (const [pattern, offset] of relativeDays) {
      const match = text.match(pattern);
      if (match) {
        expressions.push({
          kind: "relative",
          raw: match[0],
          offset,
          unit: "day",
        });
        break;
      }
    }
  }

  const relativePeriods = [
    [/(?:지난|저번)\s*주/u, "week", -1],
    [/(?:이번|금)\s*주/u, "week", 0],
    [/다음\s*주/u, "week", 1],
    [/(?:지난|저번)\s*(?:달|개월)/u, "month", -1],
    [/이번\s*(?:달|개월)/u, "month", 0],
    [/다음\s*(?:달|개월)/u, "month", 1],
    [/지난\s*분기/u, "quarter", -1],
    [/이번\s*분기/u, "quarter", 0],
    [/다음\s*분기/u, "quarter", 1],
    [/작년/u, "year", -1],
    [/올해/u, "year", 0],
    [/내년/u, "year", 1],
  ] as const;
  for (const [pattern, unit, offset] of relativePeriods) {
    const match = text.match(pattern);
    if (match) {
      expressions.push({ kind: "relative", raw: match[0], offset, unit });
      break;
    }
  }

  expressions.push(...technical);
  const seen = new Set<string>();
  return expressions.filter((expression) => {
    const key = `${expression.kind}\u0000${expression.raw}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractKoreanOccurrenceEvent(
  content: string,
  context: {
    locale: string;
    observedAt?: string;
    timezone?: string;
  },
): { content: string; occurrenceExpression: LanguageTemporalExpression } | undefined {
  if (
    /[?？]/u.test(content) ||
    KOREAN_CONFIRMATION_QUESTION_PATTERN.test(content) ||
    /(?:무엇|뭐|누구|어디|언제|왜|어떻게)(?:입니까|인가요|예요|이에요)?[.!。！]?$|(?:습니까|나요|까요)[.!。！]?$/u.test(
      content,
    ) ||
    /(?:안|못)\s*\p{L}|않(?:았|었)/u.test(content)
  ) {
    return undefined;
  }
  const maskedLiterals = maskQuotedTemporalLiterals(content);
  const occurrenceExpression = parseKoreanTemporalExpressions(maskedLiterals)[0];
  if (!occurrenceExpression) {
    return undefined;
  }

  const expressionIndex = maskedLiterals.indexOf(occurrenceExpression.raw);
  const before = content.slice(0, expressionIndex);
  const after = content.slice(expressionIndex + occurrenceExpression.raw.length)
    .replace(/^(?:에|에는|에서)\s*/u, "");
  const canonical = `${before}${after}`
    .replace(/\s{2,}/gu, " ")
    .trim();
  const canonicalize = canResolveOccurrenceExpression({
    ...context,
    expression: occurrenceExpression,
  });

  return isCompletedKoreanFirstPersonEvent(canonical)
    ? {
      content: canonicalize ? canonical : content,
      occurrenceExpression,
    }
    : undefined;
}

function hasKoreanOccurrenceContext(
  message: Parameters<LanguagePack["extractCandidates"]>[0]["messages"][number],
): boolean {
  return hasOccurrenceResolutionContext(message);
}

function extractKoreanEntityMentions(text: string): LanguageEntityMention[] {
  return extractPatternMentions(text, [
    { kind: "term", pattern: /[「“"'‘]([^」”"'’]{2,40})[」”"'’]/gu },
    {
      kind: "person",
      pattern: /([\p{Script=Hangul}]{2,12})\s*(?:씨|님)(?:은|는|이|가|을|를)?(?=[\s,，.!?。！？]|$)/gu,
    },
    {
      kind: "organization",
      pattern:
        /([\p{Script=Hangul}A-Za-z0-9&.-]{2,30}(?:주식회사|대학교|대학|회사|그룹|재단|협회|은행|병원|연구소|연구원)(?:\s+(?:연구소|연구원|센터|팀))?)/gu,
    },
    {
      kind: "identifier",
      pattern: /\b([A-Za-z]+[-_]\d+|[A-Z]{2,}\d*)\b/gu,
    },
  ]);
}

const KOREAN_RENDER_CATALOG = {
  active_context: "현재 컨텍스트",
  canonical_pattern: "정규 패턴",
  guidance: "지침",
  instruction: "명령",
  metadata: "메타데이터",
  playbook_title: "플레이북: {rule}",
  procedure: "절차",
  prompt_snippet_title: "프롬프트 스니펫: {rule}",
  skill_snippet_title: "스킬 스니펫: {rule}",
  use_when: "사용 시점",
  why: "이유",
  actor: "주체",
  additional_project_state: "추가 프로젝트 상태 컨텍스트",
  archive: "세션 보관 기록",
  archive_recap: "보관 기록 요약: {sessionId}",
  artifact_spills: "외부 저장 콘텐츠",
  behavioral_controls_available:
    "결정적 최종 답변 수정에 사용할 관련 원시 경험 제어가 있습니다.",
  behavioral_exact_surface: "정확한 실행 형식:",
  behavioral_example: "예시 {index}:",
  behavioral_observed_outcome: "관찰된 결과:",
  behavioral_raw_response_control: "원시 응답 제어:",
  behavioral_relevant_prior_examples: "관련 이전 예시:",
  behavioral_safe_corrected_move: "안전하게 수정한 동작:",
  behavioral_situation: "상황:",
  behavioral_successful_move: "성공한 동작:",
  claim: "주장",
  correction: "정정",
  current_goal: "현재 목표",
  current_projects: "현재 프로젝트",
  current_state: "현재 상태",
  constraints: "제약 조건",
  deferred_follow_up: "보류된 후속 컨텍스트",
  developer_memory_notes: "개발자 메모리 노트:",
  durable_memory: "영구 메모리",
  earlier_messages_compacted: "이전 메시지가 압축되었습니다.",
  episode: "관련 에피소드",
  episode_assistant_follow_through_captured: "어시스턴트 후속 조치를 기록했습니다.",
  episode_assistant_follow_through_on: "어시스턴트 후속 조치: {highlight}",
  episode_assistant_substantive_continuity_captured:
    "어시스턴트의 실질적인 연속 대응을 기록했습니다.",
  episode_conversation_covered: "대화에서 다룬 내용: {segments}",
  episode_item: "에피소드",
  evidence: "근거",
  evidence_entry: "근거 {evidenceId}은 메모리 {memoryId}을 기반으로 합니다.",
  evidence_note: "각 항목을 시간 상태와 근거 관계에 따라 해석하세요.",
  experiences: "경험 기록",
  excerpt: "발췌",
  fact: "사실",
  fact_item: "사실",
  feedback: "피드백",
  file_evidence: "파일 근거",
  file_or_function: "파일/함수",
  goals: "목표",
  immediate_next_steps: "즉시 실행할 다음 단계",
  installed_host_claude_memory_protocol:
    "GoodMemory는 Claude Code 자동 메모리를 보완합니다. 세션 작업 노트는 MEMORY.md에 유지하고, 영구 프로젝트 사실, 결정, 선호 사항은 GoodMemory에 저장하여 각 프롬프트에 출처와 함께 표시되도록 하세요. Hook으로 주입된 GoodMemory 내용을 MEMORY.md에 복사하지 마세요.",
  installed_host_context_tool_protocol:
    "주입된 컨텍스트가 없거나 충분하지 않으면 구체적인 질문으로 goodmemory_get_context를 호출하세요. 현재 프롬프트뿐 아니라 어떤 질문이든 사용할 수 있습니다.",
  installed_host_injected_context_protocol:
    "Hook으로 주입된 ‘개발자 메모리 노트’ 블록은 현재 프롬프트를 위해 검색된 메모리입니다. 계획 전에 읽고 프로젝트 사실을 다시 추론하기보다 우선 사용하세요. 시간에 민감한 사실은 실행 전에 저장소에서 검증하세요.",
  installed_host_intro:
    "이 저장소는 영구적이고 관리되는 메모리를 위해 GoodMemory(설치된 {host} 호스트 경로)를 사용합니다.",
  installed_host_projection_protocol:
    "내보낸 산출물 파일은 정본이 아닌 투영으로 취급하고, 주입된 메모리를 파일이나 커밋 메시지에 그대로 다시 쓰지 마세요.",
  installed_host_protocol_heading: "메모리 프로토콜:",
  installed_host_record_tools_protocol:
    "렌더링된 요약이 아니라 특정 레코드가 필요하면 goodmemory_search_index를 호출한 다음 goodmemory_get_records를 호출하세요. 메모리가 잘못되었거나 예상과 달리 누락된 것 같으면 goodmemory_trace_recall을 호출하여 선택되거나 제외된 이유를 확인하세요.",
  installed_host_remember_protocol:
    "보존할 가치가 있는 영구 사실, 결정, 선호 사항 또는 장애 요인을 알게 되었고 goodmemory_remember 도구를 사용할 수 있으면 호출할 때마다 하나의 명확한 문장으로 저장하세요. 쓰기는 관리되고 감사 가능하며, 결과는 거부 이유를 설명합니다.",
  journal: "세션 저널",
  key_decisions: "주요 결정",
  key_files: "주요 파일",
  language_label: "언어",
  learning_proposals: "학습 제안",
  lineage: "계보",
  location: "위치",
  memory_index: "메모리 색인",
  name: "이름",
  none: "없음",
  organization: "조직",
  open_loops: "미완료 항목",
  omitted_sections: "생략된 섹션: {sections}",
  preference: "선호 사항",
  procedural_memory: "절차 메모리",
  profile: "프로필",
  progressive_detail_instruction:
    "더 자세한 컨텍스트가 필요할 때만 recordRef 값을 상세 도구에 사용하세요.",
  progressive_detail_instruction_compact:
    "필요할 때 recordRef를 상세 도구에 사용하세요.",
  progressive_recall: "단계적 GoodMemory 회상",
  promotions: "승격 기록",
  recent_decisions: "최근 결정",
  recent_worklog: "최근 작업 기록",
  reference: "참조 자료",
  reference_item: "참조",
  referenced_artifacts: "참조된 산출물",
  relation_label: "관계",
  role_label: "역할",
  scope: "범위",
  session_archive_item: "세션 보관 기록",
  session_ended_without_summary: "통합 요약 없이 세션이 종료되었습니다.",
  session_handoff: "세션 인계: {sessionId}",
  session_memory: "세션 메모리: {sessionId}",
  session_resume_query:
    "이 코딩 세션에서 이어서 처리할 연속 정보, 현재 컨텍스트, 미완료 항목은 무엇입니까?",
  session_start_query:
    "이 코딩 세션을 시작할 때 알아야 할 현재 컨텍스트, 연속 정보, 미완료 항목은 무엇입니까?",
  summary: "요약",
  temporal_status: "시간 상태",
  detail_tokens: "상세 토큰 수",
  omitted_records: "생략된 레코드 수: {count}",
  record_kind: "종류",
  record_ref: "참조",
  temporary_decision: "임시 결정",
  timezone: "시간대",
  tool_result: "도구 결과",
  verification: "검증",
  user_memory_context: "사용자 메모리 컨텍스트:",
  user_memory: "사용자 메모리",
  undated: "날짜 없음",
  default_label: "기본값",
  workflow: "워크플로",
  working_memory: "작업 메모리",
  workspace_query_anchor: "작업 공간: {workspace}.",
} as const satisfies Readonly<Record<LanguageRenderKey, string>>;

function renderKorean(input: LanguageRenderInput): string {
  return renderFromCatalog(input, KOREAN_RENDER_CATALOG);
}

export function createKoreanLanguagePack(): LanguagePack {
  return {
    analyzerVersion: "7-interrogative-admission",
    apiVersion: 1,
    compatibilityGroup: "ko",
    defaultLocale: "ko-KR",
    id: "ko",
    locales: ["ko"],
    detect({ texts }) {
      return texts.some((text) => /\p{Script=Hangul}/u.test(text))
        ? "distinctive"
        : "none";
    },
    normalizeForEquality: normalizeUnicodeForEquality,
    splitClauses: splitKoreanClauses,
    splitSentences: splitSentencesGeneric,
    tokenizeForScoring(text, _mode, options) {
      const tokens = koreanTokenVariants(text);
      return options?.excludeStopwords
        ? koreanRetrievalTokens(text)
        : tokens;
    },
    buildSearchTerms(text) {
      return koreanRetrievalTokens(text);
    },
    decomposeQuery(text) {
      return decomposeQueryByPattern(
        text,
        /(?:그리고|또한|아울러|게다가|및|와 함께)/u,
      );
    },
    analyzeBehavioralRule(text) {
      return analyzeBehavioralRuleWithPatterns(text, BEHAVIORAL_RULE_PATTERNS);
    },
    analyzeQuery: analyzeKoreanQuery,
    analyzeContent: analyzeKoreanContent,
    parseTemporalExpressions: parseKoreanTemporalExpressions,
    matchesEventPredicate: matchesKoreanEventPredicate,
    extractEntityMentions: extractKoreanEntityMentions,
    matchesEntityAlias(query, alias) {
      if (/\p{Script=Hangul}/u.test(alias)) {
        const normalizedAlias = normalizeUnicodeForEquality(alias);
        return normalizedAlias.length >= 2 &&
          normalizeUnicodeForEquality(query).includes(normalizedAlias);
      }
      return matchesNormalizedEntityAlias(
        query,
        alias,
        normalizeUnicodeForEquality,
      );
    },
    acceptsEntityCandidate() {
      return true;
    },
    deriveDurableTarget(candidate) {
      return deriveLanguageDurableTarget(
        candidate,
        KOREAN_DURABLE_TARGET_ALIASES,
      );
    },
    extractCandidates: extractKoreanCandidates,
    render: renderKorean,
  };
}
