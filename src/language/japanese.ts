import type { MemoryCandidate } from "../domain/memoryCandidate";
import { createDurableTargetIdentity } from "../domain/memoryCandidate";
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
  LanguageTemporalExpression,
} from "./contracts";
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
  parseCjkTemporalReference,
} from "./temporal";

const JAPANESE_INTERROGATIVE_ANCHORS = [
  "何人",
  "何",
  "なに",
  "誰",
  "だれ",
  "どれ",
  "どの",
  "どちら",
  "どなた",
  "どんな",
  "どこ",
  "いつ",
  "なぜ",
  "どういう",
  "どうして",
  "どうやって",
  "どのように",
  "どう",
  "なんで",
  "なん",
  "いくつ",
  "いくら",
] as const;
const JAPANESE_STOPWORDS = new Set([
  "これ",
  "それ",
  "ため",
  "です",
  "ます",
  "いる",
  "ある",
  "する",
  "した",
  "して",
  "てい",
  "の",
  "は",
  "が",
  "を",
  "に",
  "で",
  "と",
  "も",
  ...JAPANESE_INTERROGATIVE_ANCHORS,
]);
const JAPANESE_INTERROGATIVE_ANCHOR_SOURCE =
  `(?:${JAPANESE_INTERROGATIVE_ANCHORS.join("|")})`;
const JAPANESE_INTERROGATIVE_ANCHOR_SET = new Set<string>(
  JAPANESE_INTERROGATIVE_ANCHORS,
);
const JAPANESE_DURABLE_TARGET_ALIASES = {
  タイムゾーン: "profile:timezone",
  位置: "profile:location",
  使用言語: "profile:languagePreference",
  役割: "profile:role",
  所属: "profile:organization",
  現在のプロジェクト: "profile:currentProject",
  現在の役割: "profile:role",
  組織: "profile:organization",
  言語設定: "profile:languagePreference",
  プロジェクトコード: "assignment:project_code",
  プロジェクト代号: "assignment:project_code",
  名前: "profile:name",
  好み: "preference",
} as const;

const COMPLETED_FIRST_PERSON_EVENT_PATTERN =
  /^(?:(?:私|僕|俺)(?:は|が))[^。！？]+(?:ました|だった|でした|した|った|いた|いだ|んだ|えた)[。！？]?$/u;
const FUTURE_FIRST_PERSON_PLAN_PATTERN =
  /^(?:(?:私|僕|俺)(?:は|が))[^。！？]*(?:予定です|つもりです|予定だ|つもりだ|する予定)[。！？]?$/u;
const JAPANESE_BEHAVIORAL_DIRECTIVE_PATTERN =
  /(?:しないで|[てで](?:ください|下さい)|(?:お)?願います|すること|(?:を|から|まで)[^。！？「」]{1,80}(?:[えけげせてねべめれ]|ろ|よ|なさい|[くぐすつぬぶむるう]な)|(?:を|から|まで)[^。！？「」]{0,80}(?:来い|しろ|せよ)|(?:ここ|そこ|あそこ)(?:で|へ)[^。！？「」]{0,40}(?:[えけげせてねべめれ]|ろ|よ|なさい|来い|しろ|せよ))[。.!！]?$/u;
const JAPANESE_DURABLE_BEHAVIORAL_SCOPE_PATTERN =
  /^(?:今後|これから|常に|いつも|毎回|必ず|二度と)|(?:今後|これから|常に|いつも|毎回|必ず|二度と)/u;
const JAPANESE_BEHAVIORAL_SUBORDINATE_PATTERN =
  /(?:前に|後に|とき(?:に)?|場合(?:は|に)?)$/u;
const JAPANESE_CORRECTION_PREAMBLE_PATTERN =
  /^(?:訂正|修正)(?:です)?(?=\s|[：:、,。]|$)\s*[：:、,。]?\s*/u;

const BEHAVIORAL_RULE_PATTERNS = {
  firstAction: [
    /(?:まず|最初に|先に)\s*([A-Za-z_][A-Za-z0-9_@.-]*)/u,
    /([A-Za-z_][A-Za-z0-9_@.-]*)\s*(?:を)?\s*(?:まず|最初に|先に)/u,
  ],
  format: /(冒頭|書き出し|末尾|締め|接頭辞|接尾辞|署名|件名|形式)/u,
  general: /(常に|必ず|べき|今後|いつも|毎回)/u,
  hostAction: {
    destination: [
      /['"`]([^'"`]+)['"`]\s*(?:へ|に)(?:コピー|複製|移動)/u,
      /((?:~\/|\/)[A-Za-z0-9._/-]+)\s*(?:へ|に)(?:コピー|複製|移動)/u,
    ],
    verbs: [
      { pattern: /(?:コピー|複製)/u, value: "copy" },
      { pattern: /移動/u, value: "move" },
    ],
  },
  negative: /(避け|しないで|してはいけない|禁止|決して|ではなく)/u,
  trigger: [
    /^(.+?)(?:では|には|のとき|する前)(?:[、,]|\s)/u,
  ],
} as const;

const QUERY = {
  actionDriving: /(送信|公開|リリース|デプロイ|実行|進め|決定|次のステップ|次に何を|移行案|編集|変更|削除|書き込|確認|チェック)/u,
  after: /(以降|以来|より後|後で)/u,
  aggregateCount: /(いくつ|何件|何個|何項目|合計|総額|全部で|いくら)/u,
  answer: /(返信|返答|回答|要約|まとめ|概要|ドラフト)/u,
  assistantEvidenceRecall: /(前回|以前|さっき|先ほど|あなたが(?:言った|教えた|提案した|勧めた)|リスト|思い出させ)/u,
  blocker: /(ブロッカー|障害|阻害要因|行き詰まり|承認待ち|妨げ)/u,
  before: /(以前|より前|前まで|前に|する前)/u,
  change: /(変更|変わ|切り替|移行|以前は|置き換)/u,
  confirm: /(確認)/u,
  continuation: /(続け|再開|前回の続き|引き続き|途中から)/u,
  directFactualLookup: /^(誰|だれ|何|なに|どこ|いつ|どれ|どの|いくつ|いくら|前回|以前)/u,
  factConfirmationTarget: /(役割|職位|重点|注力|ブロッカー|障害|未完了|残件|承認|検証)/u,
  focus: /(重点|注力|フォーカス|現在取り組んで|いま取り組んで)/u,
  exhaustiveList: /(すべて|全て|全部|一覧|リスト|どれ|残り|未完了|未解決|残件|保留中)/u,
  current: /(現在|最新|現時点|いま)/u,
  guidanceSeeking: /(好み|希望|スタイル|形式|フォーマット|口調|ルール|指示|避け|返信方法)/u,
  openLoop: /(オープンループ|未完了|未解決|残件|TODO|やること|要確認)/iu,
  history: /(履歴|歴史|過去|以前|これまで|前回)/u,
  procedural: /(どうすれば|どのように|手順|方法|ワークフロー|ランブック)/u,
  projectState: /(プロジェクト|ワークフロー|移行|リリース|展開|承認|ブロッカー|未完了|検証)/u,
  recommendationStyle: /(おすすめ|推奨|提案|助言|アドバイス|どうすれば|どうしたら|方法)/u,
  reference: /(ランブック|手順書|文書|ドキュメント|参照|情報源|正とする|基準|ガイド)/u,
  relation: /(何で知られ|何で有名|関連|関係|つなが|誰に報告|メンター)/u,
  role: /(役割|職位|ポジション)/u,
} as const;

const CONTENT = {
  assistantAck: /^(了解|承知しました|わかりました|はい|記録しました|更新しました|問題ありません)[。！!]?$/u,
  assistantContinuity: /(続け|今後|次に|フォロー|維持|更新|確認|対応)/u,
  blockerFact: /(ブロッカー|障害|阻害要因|承認待ち|行き詰ま)/u,
  correctionCue: /(訂正|修正|変更|置き換|代わり|ではなく|正とする|基準にする)/u,
  dont: /(しないで|しないこと|避けて|禁止)/u,
  durableCue: /(覚えて|記憶して|忘れないで|正とする|基準にする|ランブック|ブロッカー|障害|好み|優先|現在の役割|タイムゾーン|使用言語|現在の重点|プロジェクト)/u,
  focusFact: /(現在の重点は|現在の注力先は|いま取り組んでいるのは|現在取り組んでいる|現在.+(?:集中|注力))/u,
  negative: /(ブロック|失敗|未完了|未解決|不安定|行き詰ま)/u,
  openLoopFact: /(オープンループ|未完了|未解決|残件|TODO|必要がある|しなければならない)/iu,
  personalEvidence: /(私|わたし|自分|僕|ぼく|私たち|我々)/u,
  positive: /(安定|解決済み|解決した|完了|修正済み|閉じた)/u,
  preferenceEvidence: /(好み|好き|希望|望む|欲しい|興味|関心|避けたい|嫌い|困って|問題)/u,
  prefer: /(好み|優先|より好き)/u,
  projectStateFact: /(次のマイルストーン|次のステップ|保留|待機中|残って|レビュー待ち|確認待ち|フォローが必要|プロジェクト.+(?:段階|状態|フェーズ))/u,
  roleFact: /(私の現在の役割は|現在の役割は|私は.+(?:担当|責任者|エンジニア|マネージャー))/u,
  sensitiveCredential:
    /(?:API\s*)?(?:パスワード|秘密鍵|シークレット|トークン)\s*[:=：]\s*\S+/iu,
  unresolved: /(未完了|未解決|残件|保留|ブロッカー|次のステップ|要確認|フォロー)/u,
  validated: /(役に立った|有効だった|うまくいった|このまま続けて)/u,
} as const;

const JAPANESE_EXPLICIT_FACT_DIRECTIVE_PATTERN =
  /^(?:これを\s*)?(?:(?:[一二三四五六七八九十\d]+つのことを)?(?:覚えておいて(?:ください)?|覚えて(?:ください)?|記憶して(?:ください)?|忘れないで(?:ください)?))(?=[：:,，、。！？；;\s]|$)/u;
const JAPANESE_EXPLICIT_FACT_COUNT_PATTERN =
  /^(?:これを\s*)?([一二三四五六七八九十\d]+)つのことを/u;
const JAPANESE_EXPLICIT_FACT_OPT_OUT_PATTERN =
  /(?:覚えておかないで|覚えないで|記憶しないで|保存しないで|忘れて)(?:ください)?[。.!！]?\s*$/u;
const JAPANESE_EXPLICIT_FACT_QUESTION_PATTERN = new RegExp(
  `${JAPANESE_INTERROGATIVE_ANCHOR_SOURCE}(?:$|.*(?:ですか|ますか|でしょうか|なのか|か)$)`,
  "u",
);
const JAPANESE_EXPLICIT_FACT_POSTPOSED_QUESTION_VALUE_PATTERN = new RegExp(
  `[、，,]\\s*${JAPANESE_INTERROGATIVE_ANCHOR_SOURCE}(?:ですか|なのか|か)?$`,
  "u",
);
const JAPANESE_EXPLICIT_FACT_CONFIRMATION_PATTERN =
  /(?:正しい|合っている|合っています|間違いない)(?:ですか|ますか|でしょうか|か)?[?？]?\s*$/u;
const JAPANESE_CONFIRMATION_QUESTION_PATTERN =
  /(?:よね|ですよね|でしょう|ではありませんか)[。！]?$/u;
const JAPANESE_CLEAR_TRAILING_QUESTION_PATTERN = new RegExp(
  `${JAPANESE_INTERROGATIVE_ANCHOR_SOURCE}.*(?:ですか|ますか|でしょうか|なのか|か)\\s*$|(?:ですか|ますか|でしょうか|なのか|ますでしょうか|か)\\s*$`,
  "u",
);
const JAPANESE_EXPLICIT_FACT_OPT_OUT_CLAUSE_BOUNDARY_PATTERN =
  /(?:[、，,]\s*|(?:そして|また|でも|しかし)\s*)(?=[^。！？；;\n]{0,240}(?:覚えておかないで|覚えないで|記憶しないで|保存しないで|忘れて))/u;
const JAPANESE_EXPLICIT_FACT_OPT_OUT_GRAMMAR_PATTERN =
  /^[^。！？；;\n]{0,240}(?:覚えておかないで|覚えないで|記憶しないで|保存しないで|忘れて)(?:ください)?[。.!！]?\s*$/u;
const JAPANESE_REPORTED_DIRECTIVE_PREFIX_PATTERN =
  /(?:言って|伝えて|頼んで|求めて|書いて|引用して)(?:いません|いない|いませんでした|いなかった)|(?:言いました|伝えました|頼みました|求めました|書きました|引用しました)(?:[、,:：]|\s|$)/u;
const JAPANESE_REPORTED_DIRECTIVE_SUFFIX_PATTERN =
  /^(?:と(?:は)?|って)(?:言って|伝えて|頼んで|求めて|書いて)(?:いません|いない|いませんでした|いなかった)/u;

function hasJapaneseReportedDirectiveScope({
  clause,
  prefix,
  suffix,
}: DirectiveGrammarMatch): boolean {
  return JAPANESE_REPORTED_DIRECTIVE_PREFIX_PATTERN.test(clause) ||
    JAPANESE_REPORTED_DIRECTIVE_PREFIX_PATTERN.test(prefix) ||
    JAPANESE_REPORTED_DIRECTIVE_SUFFIX_PATTERN.test(suffix.trim());
}

function japaneseFactCount(content: string): number | undefined {
  const token = content.match(JAPANESE_EXPLICIT_FACT_COUNT_PATTERN)?.[1];
  if (!token) {
    return 1;
  }
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 0) {
    return numeric;
  }
  const counts: Readonly<Record<string, number>> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return counts[token];
}

function analyzeJapaneseQuery(query: string): LanguageQueryAnalysis {
  const role = QUERY.role.test(query);
  const focus = QUERY.focus.test(query);
  const openLoop = QUERY.openLoop.test(query);
  const blocker = QUERY.blocker.test(query);
  const before = QUERY.before.test(query.replace(/\d{1,3}\s*日前/gu, ""));
  const occurrenceExpression = parseJapaneseTemporalExpressions(query)[0];
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
        /(?:以前|より前|前まで|以降|より後)\s*$/u.test(prefix) ||
        /^\s*(?:以前|より前|前まで|以降|より後)/u.test(suffix) ||
        /[「『“"]\s*$/u.test(prefix) && /^\s*[」』”"]/u.test(suffix)
      ) {
        return undefined;
      }
    }
    if (/何が[^。！？?]{0,20}(?:起きました|ありました)(?:か)?/u.test(query)) {
      return "broad";
    }
    return (
      /(?:何|なに|どこ|誰|だれ|どの)[^。！？?]{0,60}(?:食べ|飲み|し|やり|完了し|提出し|公開し|行き|見|買い|会い|更新し)[^。！？?]{0,20}(?:ました|た)(?:か)?/u.test(
        query,
      )
    ) ? "predicate" : undefined;
  })();
  const userGroundedEventOrder =
    /(順番|順序|時系列|最初[\s\S]{0,80}最後)/u.test(query) &&
    /(?:私|僕|自分)[\s\S]{0,80}(?:話した|言及した|取り上げた|話題にした)/u.test(
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
    factConfirmation: role || focus || openLoop || blocker ||
      (QUERY.confirm.test(query) && QUERY.factConfirmationTarget.test(query)),
    focus,
    guidanceSeeking: QUERY.guidanceSeeking.test(query),
    history: !before && QUERY.history.test(query),
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

function analyzeJapaneseSourceOfTruthDirective(content: string) {
  const negated = (index: number, pointerLength: number): boolean => {
    const prefix = content.slice(Math.max(0, index - 96), index);
    const suffix = content.slice(index + pointerLength, index + pointerLength + 128);
    return (
      /(?:使わず|使用せず|参照せず)\s*$/u.test(prefix) ||
      /^\s*(?:ではなく|でなく|を使わず|を使用せず)/u.test(suffix)
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
      return /^\s*(?:を正とする|を基準にする|を参照する|が正本)/u.test(suffix);
    },
    negated,
    trimPointerSuffix(pointer) {
      return pointer.replace(/(?:を正とする|を基準にする|を参照する|が正本)$/u, "");
    },
  });
}

function analyzeJapaneseContent(content: string): LanguageContentAnalysis {
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
    assistantAcknowledgement: CONTENT.assistantAck.test(content.trim()),
    assistantContinuity: CONTENT.assistantContinuity.test(content),
    behavioralDirective: classifyJapaneseBehavioralDirective(content),
    blockerFact: CONTENT.blockerFact.test(content),
    correctionCue: CONTENT.correctionCue.test(content),
    durableCue: CONTENT.durableCue.test(content),
    factPolarity,
    feedbackKind,
    focusFact: CONTENT.focusFact.test(content),
    interrogative: isJapaneseInterrogativeClause(content, content),
    openLoopFact: CONTENT.openLoopFact.test(content),
    personalEvidence: CONTENT.personalEvidence.test(content),
    preferenceEvidence: CONTENT.preferenceEvidence.test(content),
    projectStateFact: CONTENT.projectStateFact.test(content),
    roleFact: CONTENT.roleFact.test(content),
    sensitiveCredential: CONTENT.sensitiveCredential.test(content),
    sourceOfTruthDirective: analyzeJapaneseSourceOfTruthDirective(content),
    unresolved: CONTENT.unresolved.test(content),
  };
}

function classifyJapaneseBehavioralDirective(
  content: string,
): NonNullable<LanguageContentAnalysis["behavioralDirective"]> {
  const trimmed = content.trim();
  if (
    JAPANESE_EXPLICIT_FACT_DIRECTIVE_PATTERN.test(trimmed) ||
    JAPANESE_EXPLICIT_FACT_OPT_OUT_PATTERN.test(trimmed) ||
    analyzeJapaneseSourceOfTruthDirective(trimmed) ||
    /(?:が好き|を好む|を希望する|を希望します)/u.test(trimmed)
  ) {
    return "none";
  }

  const unquoted = maskQuotedText(trimmed).trim();
  if (!unquoted) {
    return "none";
  }
  const correctionMatch = unquoted.match(JAPANESE_CORRECTION_PREAMBLE_PATTERN);
  const corrected = correctionMatch
    ? unquoted.slice(correctionMatch[0].length).trim()
    : unquoted;
  if (!corrected) {
    return correctionMatch ? "one_off" : "none";
  }
  if (
    JAPANESE_DURABLE_BEHAVIORAL_SCOPE_PATTERN.test(corrected) &&
    JAPANESE_BEHAVIORAL_DIRECTIVE_PATTERN.test(corrected)
  ) {
    return "durable";
  }
  return JAPANESE_BEHAVIORAL_DIRECTIVE_PATTERN.test(corrected)
    ? "one_off"
    : "none";
}

function resolveJapaneseFactKind(
  content: string,
  providedAnalysis?: LanguageContentAnalysis,
): FactKind {
  const analysis = providedAnalysis ?? analyzeJapaneseContent(content);
  if (analysis.blockerFact) return "blocker";
  if (analysis.openLoopFact) return "open_loop";
  if (analysis.focusFact) return "focus_update";
  if (analysis.projectStateFact) return "project_state";
  return "generic_project";
}

function cleanJapaneseExplicitFact(value: string): string {
  return value
    .trim()
    .replace(/^[：:,，、。！？；;\s]+/u, "")
    .replace(/[：:,，、。！？；;]+$/u, "")
    .trim();
}

function extractJapaneseOptOutTarget(content: string): string {
  return content
    .replace(JAPANESE_EXPLICIT_FACT_OPT_OUT_PATTERN, "")
    .replace(/(?:は|を)\s*$/u, "")
    .trim();
}

function splitJapaneseClauses(text: string): string[] {
  return splitClausesGeneric(text)
    .filter(Boolean)
    .flatMap((clause) =>
      JAPANESE_EXPLICIT_FACT_DIRECTIVE_PATTERN.test(clause.trim()) ||
        JAPANESE_EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : splitTrailingClause(
          clause,
          (candidate) => isJapaneseInterrogativeClause(candidate, candidate),
          (candidate) =>
            /[?？]\s*$/u.test(maskQuotedText(candidate)) ||
            JAPANESE_CLEAR_TRAILING_QUESTION_PATTERN.test(
              maskQuotedText(candidate).trim(),
            ),
        )
    )
    .flatMap((clause) =>
      JAPANESE_EXPLICIT_FACT_DIRECTIVE_PATTERN.test(clause.trim()) ||
        JAPANESE_EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : splitTrailingClause(
          clause,
          (candidate) =>
            classifyJapaneseBehavioralDirective(candidate) !== "none" ||
            JAPANESE_DURABLE_BEHAVIORAL_SCOPE_PATTERN.test(
              maskQuotedText(candidate).trim(),
            ),
          (candidate) =>
            classifyJapaneseBehavioralDirective(candidate) !== "none",
          (candidate) => /^(?:お願い(?:します)?|お願いします)$/u.test(
            candidate.trim(),
          ) || JAPANESE_BEHAVIORAL_SUBORDINATE_PATTERN.test(candidate.trim()),
        )
    )
    .flatMap((clause) =>
      !JAPANESE_EXPLICIT_FACT_DIRECTIVE_PATTERN.test(clause.trim()) &&
        JAPANESE_EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : clause.split(JAPANESE_EXPLICIT_FACT_OPT_OUT_CLAUSE_BOUNDARY_PATTERN)
    )
    .map((clause) =>
      isolateDirectiveGrammar(
        clause,
        JAPANESE_EXPLICIT_FACT_OPT_OUT_GRAMMAR_PATTERN,
        hasJapaneseReportedDirectiveScope,
      )
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function isJapaneseInterrogativeClause(
  content: string,
  source: string,
): boolean {
  const unquotedContent = maskQuotedText(content).trim();
  const unquotedSource = maskQuotedText(source).trim();
  if (JAPANESE_CONFIRMATION_QUESTION_PATTERN.test(unquotedContent)) {
    return true;
  }
  const assignmentIndex = content.search(/[=＝]/u);
  if (assignmentIndex >= 0) {
    const left = content.slice(0, assignmentIndex).trim();
    const right = content.slice(assignmentIndex + 1).trim();
    if (JAPANESE_EXPLICIT_FACT_QUESTION_PATTERN.test(left)) {
      return true;
    }
    const assignmentConfirmation =
      JAPANESE_EXPLICIT_FACT_CONFIRMATION_PATTERN.test(right) &&
      /(?:ですか|ますか|でしょうか|か)\s*$/u.test(right);
    if (assignmentConfirmation) {
      return true;
    }
    if (hasUnterminatedQuote(right)) {
      return true;
    }
    if (isExplicitlyQuotedValue(right)) {
      return false;
    }
    if (JAPANESE_EXPLICIT_FACT_POSTPOSED_QUESTION_VALUE_PATTERN.test(right)) {
      return true;
    }
    if (/[?？]\s*$/u.test(unquotedSource)) {
      return true;
    }
    return false;
  }

  return /[?？]\s*$/u.test(unquotedSource) ||
    /(?:ですか|ますか|でしょうか|なのか|ますでしょうか|か)\s*$/u.test(
      unquotedContent,
    ) ||
    JAPANESE_EXPLICIT_FACT_QUESTION_PATTERN.test(unquotedContent);
}

function japaneseRetrievalTokens(text: string): string[] {
  const protectedTokens = collectProtectedRetrievalTokens(text, "ja-JP");
  return tokenizeUnicodeText(text, "ja-JP").filter((token) =>
    protectedTokens.has(token) ||
    (!JAPANESE_STOPWORDS.has(token) &&
      !JAPANESE_INTERROGATIVE_ANCHOR_SET.has(token))
  );
}

function extractJapaneseExplicitFacts(content: string) {
  const source = content.trim();
  const directive = source.match(JAPANESE_EXPLICIT_FACT_DIRECTIVE_PATTERN);
  if (!directive) {
    return JAPANESE_EXPLICIT_FACT_OPT_OUT_PATTERN.test(source)
      ? {
        clauses: [{ content: source, disposition: "feedback" as const }],
        status: "complete" as const,
      }
      : undefined;
  }

  const expectedFactCount = japaneseFactCount(source);
  if (expectedFactCount === undefined) {
    return { clauses: [], status: "invalid" as const };
  }
  const clauses = splitJapaneseClauses(source.slice(directive[0].length));
  const cleanedClauses = clauses
    .map((sourceClause) => ({
      content: cleanJapaneseExplicitFact(sourceClause),
      sourceClause,
    }))
    .filter(({ content }) => content.length > 0);
  if (cleanedClauses.length < expectedFactCount) {
    return JAPANESE_EXPLICIT_FACT_COUNT_PATTERN.test(source)
      ? {
        clauses: cleanedClauses.map(({ content: clause, sourceClause }) => ({
          content: clause,
          disposition: JAPANESE_EXPLICIT_FACT_OPT_OUT_PATTERN.test(sourceClause)
            ? "feedback" as const
            : "fact" as const,
        })),
        status: "incomplete-counted-list" as const,
      }
      : { clauses: [], status: "invalid" as const };
  }
  if (cleanedClauses.some(({ content: clause, sourceClause }) =>
    !JAPANESE_EXPLICIT_FACT_OPT_OUT_PATTERN.test(sourceClause) &&
    isJapaneseInterrogativeClause(clause, sourceClause)
  )) {
    return { clauses: [], status: "invalid" as const };
  }

  return {
    clauses: cleanedClauses
      .slice(0, expectedFactCount)
      .map(({ content: clause, sourceClause }) => ({
        content: clause,
        disposition: JAPANESE_EXPLICIT_FACT_OPT_OUT_PATTERN.test(sourceClause)
          ? "feedback" as const
          : "fact" as const,
      })),
    status: "complete" as const,
  };
}

function extractJapaneseCandidates(
  input: Parameters<LanguagePack["extractCandidates"]>[0],
): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  for (const [index, message] of input.messages.entries()) {
    if (message.role !== "user") {
      continue;
    }
    const sourceMessageIndex = message.sourceMessageIndex ?? index;
    const clauses = expandExplicitFactCandidateClauses(
      message.content,
      extractJapaneseExplicitFacts,
      splitJapaneseClauses,
    );
    const canonicalSourceAnalysis = analyzeJapaneseContent(message.content);
    const sourceAnalysis = {
      ...(message.analysis ?? canonicalSourceAnalysis),
      behavioralDirective: canonicalSourceAnalysis.behavioralDirective,
      interrogative: canonicalSourceAnalysis.interrogative,
    };
    for (const clause of clauses) {
      const clauseIsExplicit = clause.disposition === "fact";
      const text = clause.content.trim();
      const clauseAnalysis = clauses.length === 1 && clause.content === message.content
        ? sourceAnalysis
        : analyzeJapaneseContent(text);
      if (clause.disposition === "feedback") {
        const optOutTarget = extractJapaneseOptOutTarget(text);
        candidates.push({
          content: text,
          disposition: createLanguageDurableOptOutDisposition(
            optOutTarget,
            JAPANESE_DURABLE_TARGET_ALIASES,
          ),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "feedback",
          metadata: {
            appliesTo: "general_response",
            feedbackKind: "dont",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
        continue;
      }
      if (
        clause.disposition === "ordinary" &&
        (isJapaneseInterrogativeClause(text, text) ||
          clauseAnalysis.behavioralDirective === "one_off")
      ) {
        continue;
      }
      if (
        clause.disposition === "ordinary" &&
        clauseAnalysis.behavioralDirective === "durable"
      ) {
        candidates.push({
          content: text,
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
        continue;
      }
      if (FUTURE_FIRST_PERSON_PLAN_PATTERN.test(text)) {
        candidates.push({
          content: cleanJapaneseExplicitFact(text),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "personal",
            factKind: "open_loop",
            scopeKind: "identity",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
        continue;
      }
      const occurrenceContext = hasJapaneseOccurrenceContext(message);
      const occurrenceEvent = extractJapaneseOccurrenceEvent(
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
        /(?:私の)?(?:現在の)?(?:目標|最優先事項)は\s*([^。！？]+?)(?:です|である)?[。！？]?$/u,
      )?.[1];
      const timezone = text.match(
        /(?:私の)?タイムゾーンは\s*([A-Za-z0-9_./+-]+)(?:です)?[。！？]?$/u,
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
          content: goal.trim(),
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
        /(?:私の)?名前は\s*([^。！？]+?)(?=\s*です(?:[。！？]|$)|[。！？]|$)/u,
      );
      if (name?.[1]) {
        candidates.push({
          content: name[1].trim(),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "profile",
          metadata: { profileField: "name" },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const role = text.match(/(?:私の)?現在の役割は\s*([^。！？]+)[。！？]?$/u);
      if (role?.[1]) {
        candidates.push({
          content: role[1].trim().replace(/(?:です|である)$/u, ""),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "profile",
          metadata: { profileField: "role" },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const project = text.match(
        /(?:私の)?現在のプロジェクトは\s*([^。！？]+?)(?:です|である)?[。！？]?$/u,
      )?.[1];
      if (project) {
        candidates.push({
          content: project.trim(),
          durableTarget: createDurableTargetIdentity(
            "profile:currentProject",
            project.trim(),
          ),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "project",
            factKind: "generic_project",
            scopeKind: "project",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const preference = text.match(/(?:私は|私の)?\s*([^。！？]+?)(?:が好き|を好む|を希望する|を希望します)/u);
      if (preference?.[1]) {
        const preferenceValue = preference[1].trim();
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

      if (
        clauseIsExplicit &&
        !goal &&
        !timezone &&
        !name &&
        !role &&
        !project &&
        !timezone &&
        !preference &&
        !clauseAnalysis.sourceOfTruthDirective
      ) {
        const content = cleanJapaneseExplicitFact(text);
        if (!content) {
          continue;
        }
        candidates.push({
          content,
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "project",
            factKind: resolveJapaneseFactKind(content, clauseAnalysis),
            scopeKind: "project",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      } else if (
        !role &&
        !project &&
        !preference &&
        !sourceOfTruthReference &&
        text.length >= 6 &&
        /(現在|いま|ブロッカー|障害|未完了|移行|リリース|プロジェクト)/u.test(text)
      ) {
        candidates.push({
          content: text,
          explicitness: "inferred",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "project",
            factKind: resolveJapaneseFactKind(text, clauseAnalysis),
            scopeKind: "project",
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
      JAPANESE_DURABLE_TARGET_ALIASES,
    )
  );
}

function parseJapaneseTemporalExpressions(
  text: string,
): LanguageTemporalExpression[] {
  const technical = parseTechnicalTemporalExpressions(text);
  const instant = technical.find((expression) => "iso" in expression);
  if (instant) {
    return [instant, ...technical.filter(({ raw }) => raw !== instant.raw)];
  }
  const nativeQuarter = [
    [/前四半期/u, -1],
    [/今四半期/u, 0],
    [/次の四半期/u, 1],
  ] as const;
  const quarter = nativeQuarter
    .map(([pattern, offset]) => {
      const match = text.match(pattern);
      return match
        ? {
          kind: "relative" as const,
          offset,
          raw: match[0],
          unit: "quarter" as const,
        }
        : undefined;
    })
    .find((expression) => expression !== undefined);
  const primary = quarter ?? parseCjkTemporalReference(text);
  return primary
    ? [primary, ...technical.filter(({ raw }) => raw !== primary.raw)]
    : technical;
}

function extractJapaneseOccurrenceEvent(
  content: string,
  context: {
    locale: string;
    observedAt?: string;
    timezone?: string;
  },
): { content: string; occurrenceExpression: LanguageTemporalExpression } | undefined {
  if (
    /[?？]/u.test(content) ||
    JAPANESE_CONFIRMATION_QUESTION_PATTERN.test(content) ||
    /(?:何|誰|どこ|いつ|なぜ|どうして)(?:です|ます)?か?[。！]?$|(?:です|ます)か[。！]?$/u.test(
      content,
    ) ||
    /(?:なかった|ませんでした|ではなかった)/u.test(content)
  ) {
    return undefined;
  }
  const maskedLiterals = maskQuotedTemporalLiterals(content);
  const occurrenceExpression = parseJapaneseTemporalExpressions(maskedLiterals)[0];
  if (!occurrenceExpression) {
    return undefined;
  }

  const expressionIndex = maskedLiterals.indexOf(occurrenceExpression.raw);
  const before = content.slice(0, expressionIndex);
  const after = content.slice(expressionIndex + occurrenceExpression.raw.length)
    .replace(/^(?:に|には|で)\s*/u, "");
  const canonical = `${before}${after}`.trim();
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

function hasJapaneseOccurrenceContext(
  message: Parameters<LanguagePack["extractCandidates"]>[0]["messages"][number],
): boolean {
  return hasOccurrenceResolutionContext(message);
}

function extractJapaneseEntityMentions(text: string): LanguageEntityMention[] {
  return extractPatternMentions(text, [
    { kind: "term", pattern: /「([^」]{2,40})」/gu },
    { kind: "term", pattern: /([\p{Script=Katakana}ー]{3,40})/gu },
    {
      kind: "term",
      pattern: /([\p{Script=Han}]{2,20}(?:さん|氏|社|株式会社|大学|研究所|プロジェクト))/gu,
    },
    { kind: "identifier", pattern: /\b([A-Za-z]+[-_]\d+|[A-Z]{2,}\d*)\b/gu },
  ]);
}

const JAPANESE_RENDER_CATALOG = {
  active_context: "現在のコンテキスト",
  canonical_pattern: "正規パターン",
  guidance: "ガイダンス",
  instruction: "指示",
  metadata: "メタデータ",
  playbook_title: "プレイブック: {rule}",
  procedure: "手順",
  prompt_snippet_title: "プロンプトスニペット: {rule}",
  skill_snippet_title: "スキルスニペット: {rule}",
  use_when: "使用条件",
  why: "理由",
  actor: "アクター",
  additional_project_state: "追加のプロジェクト状態",
  archive: "会話アーカイブ",
  archive_recap: "アーカイブ要約: {sessionId}",
  artifact_spills: "外部保存コンテンツ",
  behavioral_controls_available:
    "決定的な最終回答の修正に使える関連する生の経験制御があります。",
  behavioral_exact_surface: "厳密な実行形式:",
  behavioral_example: "例 {index}:",
  behavioral_observed_outcome: "観測結果:",
  behavioral_raw_response_control: "生の応答制御:",
  behavioral_relevant_prior_examples: "関連する過去の例:",
  behavioral_safe_corrected_move: "安全な修正動作:",
  behavioral_situation: "状況:",
  behavioral_successful_move: "成功した動作:",
  correction: "訂正",
  claim: "主張",
  current_goal: "現在の目標",
  current_projects: "現在のプロジェクト",
  current_state: "現在の状態",
  constraints: "制約",
  deferred_follow_up: "後続のフォローアップ",
  developer_memory_notes: "開発者メモリノート:",
  durable_memory: "永続メモリ",
  earlier_messages_compacted: "以前のメッセージは圧縮されました。",
  episode: "関連エピソード",
  episode_assistant_follow_through_captured:
    "アシスタントのフォローアップを記録しました。",
  episode_assistant_follow_through_on:
    "アシスタントのフォローアップ: {highlight}",
  episode_assistant_substantive_continuity_captured:
    "アシスタントによる実質的な継続対応を記録しました。",
  episode_conversation_covered: "会話で扱った内容: {segments}",
  episode_item: "エピソード",
  evidence: "根拠",
  evidence_entry: "根拠 {evidenceId} はメモリ {memoryId} に基づきます。",
  evidence_note: "各項目を時間状態と根拠関係に従って読んでください。",
  experiences: "経験記録",
  excerpt: "抜粋",
  fact: "事実",
  fact_item: "事実",
  feedback: "フィードバック",
  file_evidence: "ファイル根拠",
  file_or_function: "ファイル/関数",
  goals: "目標",
  immediate_next_steps: "すぐに進められる次のステップ",
  installed_host_claude_memory_protocol:
    "GoodMemory は Claude Code の自動メモリを補完します。セッション中の作業メモは MEMORY.md に残し、永続的なプロジェクトの事実、決定、設定・好みは GoodMemory に保存して、出典付きで各プロンプトに表示されるようにしてください。Hook で注入された GoodMemory の内容を MEMORY.md にコピーしないでください。",
  installed_host_context_tool_protocol:
    "注入されたコンテキストがない、または不十分な場合は、具体的な質問で goodmemory_get_context を呼び出してください（現在のプロンプトに限らず、どの質問でも構いません）。",
  installed_host_injected_context_protocol:
    "Hook で注入された「開発者メモリノート」ブロックは、現在のプロンプトに対して取得されたメモリです。計画前に読み、プロジェクトの事実を再推論するより優先してください。時間に依存する事実は、実行前にリポジトリで検証してください。",
  installed_host_intro:
    "このリポジトリは、永続的で統制されたメモリのために GoodMemory（インストール済みの {host} ホスト経路）を使用します。",
  installed_host_projection_protocol:
    "エクスポートされたアーティファクトファイルは正規の事実ではなく投影として扱い、注入されたメモリをファイルやコミットメッセージにそのまま書き写さないでください。",
  installed_host_protocol_heading: "メモリプロトコル:",
  installed_host_record_tools_protocol:
    "表示済みの要約ではなく特定のレコードが必要な場合は、goodmemory_search_index を呼び出してから goodmemory_get_records を呼び出してください。メモリが誤っているように見える、または予期せず見つからない場合は、goodmemory_trace_recall を呼び出して選択または除外の理由を確認してください。",
  installed_host_remember_protocol:
    "保存する価値のある永続的な事実、決定、設定・好み、またはブロッカーを知り、goodmemory_remember ツールが利用できる場合は、1 回の呼び出しにつき 1 つの明確な文で保存してください。書き込みは統制され、監査可能です。拒否された場合は結果に理由が示されます。",
  journal: "セッションジャーナル",
  key_decisions: "重要な決定",
  key_files: "主要ファイル",
  language_label: "言語",
  learning_proposals: "学習提案",
  lineage: "系譜",
  location: "場所",
  memory_index: "メモリ索引",
  name: "名前",
  none: "なし",
  organization: "組織",
  open_loops: "未完了事項",
  omitted_sections: "省略されたセクション: {sections}",
  preference: "設定・好み",
  procedural_memory: "手順メモリ",
  profile: "プロフィール",
  progressive_detail_instruction:
    "詳細が必要な場合にのみ、recordRef の値を詳細ツールで使用してください。",
  progressive_detail_instruction_compact:
    "必要に応じて recordRef を詳細ツールで使用してください。",
  progressive_recall: "段階的 GoodMemory リコール",
  promotions: "昇格記録",
  recent_decisions: "最近の決定",
  recent_worklog: "最近の作業ログ",
  reference: "参照資料",
  reference_item: "参照",
  referenced_artifacts: "参照アーティファクト",
  relation_label: "関係",
  role_label: "役割",
  scope: "スコープ",
  session_archive_item: "会話アーカイブ",
  session_ended_without_summary:
    "統合された要約がないままセッションが終了しました。",
  session_handoff: "セッション引き継ぎ: {sessionId}",
  session_memory: "セッションメモリ: {sessionId}",
  session_resume_query:
    "このコーディングセッションで再開すべき継続情報、現在のコンテキスト、未完了事項は何ですか？",
  session_start_query:
    "このコーディングセッションの開始時に知るべき現在のコンテキスト、継続情報、未完了事項は何ですか？",
  tool_result: "ツール結果",
  temporal_status: "時間状態",
  summary: "要約",
  detail_tokens: "詳細トークン数",
  omitted_records: "省略レコード数: {count}",
  record_kind: "種類",
  record_ref: "参照",
  temporary_decision: "一時的な決定",
  timezone: "タイムゾーン",
  verification: "検証",
  user_memory_context: "ユーザーメモリコンテキスト:",
  user_memory: "ユーザーメモリ",
  undated: "日付なし",
  default_label: "既定",
  workflow: "ワークフロー",
  working_memory: "作業メモリ",
  workspace_query_anchor: "ワークスペース: {workspace}。",
} as const;

function renderJapanese(input: LanguageRenderInput): string {
  return renderFromCatalog(input, JAPANESE_RENDER_CATALOG);
}

export function createJapaneseLanguagePack(): LanguagePack {
  return {
    analyzerVersion: "14-durable-optout-boundary",
    apiVersion: 1,
    compatibilityGroup: "ja",
    defaultLocale: "ja-JP",
    id: "ja",
    locales: ["ja"],
    detect({ texts }) {
      const joined = texts.join(" ");
      if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(joined)) {
        return "distinctive";
      }
      return /\p{Script=Han}/u.test(joined) ? "compatible" : "none";
    },
    normalizeForEquality: normalizeUnicodeForEquality,
    splitClauses: splitJapaneseClauses,
    splitSentences: splitSentencesGeneric,
    tokenizeForScoring(text, _mode, options) {
      const tokens = tokenizeUnicodeText(text, "ja-JP");
      return options?.excludeStopwords
        ? japaneseRetrievalTokens(text)
        : tokens;
    },
    buildSearchTerms(text) {
      return japaneseRetrievalTokens(text);
    },
    decomposeQuery(text) {
      return decomposeQueryByPattern(text, /(?:そして|また|さらに|それから)/u);
    },
    analyzeBehavioralRule(text) {
      return analyzeBehavioralRuleWithPatterns(text, BEHAVIORAL_RULE_PATTERNS);
    },
    analyzeQuery: analyzeJapaneseQuery,
    analyzeContent: analyzeJapaneseContent,
    parseTemporalExpressions: parseJapaneseTemporalExpressions,
    extractEntityMentions: extractJapaneseEntityMentions,
    matchesEntityAlias(query, alias) {
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
        JAPANESE_DURABLE_TARGET_ALIASES,
      );
    },
    extractCandidates: extractJapaneseCandidates,
    render: renderJapanese,
  };
}
